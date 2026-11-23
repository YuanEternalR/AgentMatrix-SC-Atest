import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type DispatchConfig,
  type DispatchPreview,
  type DispatchSettings,
  type WorkflowInfo,
} from '../api';
import { toast } from '../components/Toast';
import { FACTOR_LABEL, label } from '../labels';

/**
 * 调度策略与权重（规格 5.5「权重可配置」+ 5.9 设置页）。
 *
 * 页面刻意做成"改 → 试算 → 保存"的闭环：
 * 只给一个选择框的话，用户永远不知道 35% 与 20% 意味着什么。
 */
export function DispatchSettings() {
  const [settings, setSettings] = useState<DispatchSettings | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [draft, setDraft] = useState<DispatchConfig | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState<DispatchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [workflowCode, setWorkflowCode] = useState('');
  const [priority, setPriority] = useState(1);
  const [complexity, setComplexity] = useState(4);

  const load = useCallback(async () => {
    try {
      const data = await api.getDispatchSettings();
      setSettings(data);
      setDraft(data.config);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
    api
      .listWorkflows()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, [load]);

  const total = useMemo(
    () => (draft ? Object.values(draft.weights).reduce((sum, v) => sum + v, 0) : 0),
    [draft],
  );

  const requiredCapabilities = useMemo(() => {
    const wf = workflows.find((w) => w.code === workflowCode);
    return wf?.required_capabilities ?? [];
  }, [workflowCode, workflows]);

  // 淘汰原因按原因归并：20 个候选可能都是"缺少同一组能力"，逐条列会把页面刷满。
  // 注意：这个 useMemo 必须写在下面的提前 return **之前**——
  // 放在 return 之后会导致"数据到达后 hook 数量变多"，React 直接抛
  // "Rendered more hooks than during the previous render"，整页白屏。
  const rejectedGroups = useMemo(() => {
    const groups = new Map<string, number>();
    for (const item of preview?.rejected ?? []) {
      groups.set(item.reason, (groups.get(item.reason) ?? 0) + 1);
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]);
  }, [preview]);

  function patchWeight(code: string, raw: number) {
    if (!draft) return;
    setDraft({ ...draft, weights: { ...draft.weights, [code]: raw } });
  }

  async function runPreview(useDraft: boolean) {
    setPreviewing(true);
    setError('');
    try {
      const data = await api.previewDispatch({
        required_capabilities: requiredCapabilities,
        priority,
        complexity_hint: complexity,
        weights: useDraft && draft ? draft.weights : undefined,
        strategy: useDraft && draft ? draft.strategy : undefined,
      });
      setPreview(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '试算失败');
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api.saveDispatchSettings(draft);
      setSettings(saved);
      setDraft(saved.config);
      toast.success('已保存：下一次调度立即使用新参数，无需重启');
      // 侧栏显示的是"当前策略"，改完要跟着变——否则保存成功但侧栏还是旧的
      window.dispatchEvent(new CustomEvent('am:strategy-changed'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) return <div className="alert">{error}</div>;
  if (!settings || !draft) return <div className="empty">加载中…</div>;

  const maxContribution = Math.max(
    ...(preview?.factors ?? []).map((f) => f.contribution),
    0.0001,
  );

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">当前生效</h2>
            <p className="card-sub">
              {label(
                Object.fromEntries(settings.strategies.map((s) => [s.name, s.label])),
                settings.config.strategy,
              )}
              <span style={{ marginLeft: 8 }}>
                {settings.source === 'db' ? '（界面配置）' : '（环境变量默认）'}
              </span>
            </p>
          </div>
          <span className="step-meta">改完点「保存」即生效</span>
        </div>

        <div className="strategy-grid">
          {settings.strategies.map((spec) => {
            const active = draft.strategy === spec.name;
            return (
              <button
                key={spec.name}
                type="button"
                className={`strategy-card ${active ? 'active' : ''}`}
                onClick={() => setDraft({ ...draft, strategy: spec.name })}
                data-testid={`strategy-${spec.name}`}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{spec.label}</strong>
                  {active && <span className="badge succeeded">已选</span>}
                </div>
                <p className="card-sub" style={{ margin: '6px 0 4px' }}>
                  {spec.description}
                </p>
                <div className="step-meta">{spec.research_role}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">打分权重</h3>
          <p className="card-sub">
            仅「加权打分」与「大模型规划」使用这些权重。系统按总和归一化，不必凑满 100%。
            当前合计 <strong>{(total * 100).toFixed(0)}%</strong>。
          </p>

          {settings.factors.map((factor) => (
            <div key={factor.code} className="weight-row">
              <div className="weight-head">
                <span className="name">{factor.label}</span>
                <span className="mono">{((draft.weights[factor.code] ?? 0) * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round((draft.weights[factor.code] ?? 0) * 100)}
                onChange={(e) => patchWeight(factor.code, Number(e.target.value) / 100)}
                data-testid={`weight-${factor.code}`}
              />
              <div className="step-meta">{factor.description}</div>
            </div>
          ))}

          <div className="row" style={{ marginTop: 12, gap: 12 }}>
            <div style={{ width: 150 }}>
              <label className="field">SLA 余量</label>
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={draft.sla_headroom}
                onChange={(e) => setDraft({ ...draft, sla_headroom: Number(e.target.value) })}
              />
            </div>
            <div style={{ width: 150 }}>
              <label className="field">质量下限</label>
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={draft.min_success_rate}
                onChange={(e) => setDraft({ ...draft, min_success_rate: Number(e.target.value) })}
              />
            </div>
            <div className="step-meta" style={{ flex: 1 }}>
              SLA 余量只影响「成本优先」策略（先按 SLA 筛掉高风险候选）；
              质量下限只影响「成本优先」策略的最低成功率要求。
            </div>
          </div>

          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button
              className="ghost"
              onClick={() => setDraft(settings.config)}
              data-testid="reset-dispatch"
            >
              还原为已保存
            </button>
            <button className="primary" disabled={busy} onClick={() => void save()} data-testid="save-dispatch">
              {busy ? '保存中…' : '保存并生效'}
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">试算：谁会被选中</h3>
          <p className="card-sub">
            用当前草稿参数跑一次真实打分（不调用真实模型、不落库）。调完滑块点这里，
            立刻能看到排名变化——这就是"设计策略"的全部反馈。
          </p>

          <div className="grid-2" style={{ gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field">按某个工作流的需求试算</label>
              <select
                value={workflowCode}
                onChange={(e) => setWorkflowCode(e.target.value)}
                data-testid="preview-workflow"
              >
                <option value="">（不指定，按空能力集试算）</option>
                {workflows.map((wf) => (
                  <option key={wf.code} value={wf.code}>
                    {wf.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field">优先级（1 最高）</label>
              <input
                type="number"
                min={1}
                max={5}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="field">复杂度（1–5）</label>
              <input
                type="number"
                min={1}
                max={5}
                value={complexity}
                onChange={(e) => setComplexity(Number(e.target.value))}
              />
            </div>
          </div>

          {requiredCapabilities.length > 0 && (
            <p className="card-sub" style={{ marginTop: 8 }}>
              该工作流要求能力：<span className="mono">{requiredCapabilities.join('、')}</span>
            </p>
          )}

          <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button disabled={previewing} onClick={() => void runPreview(false)} data-testid="preview-saved">
              用已保存参数试算
            </button>
            <button className="primary" disabled={previewing} onClick={() => void runPreview(true)} data-testid="preview-draft">
              {previewing ? '试算中…' : '用当前草稿试算'}
            </button>
          </div>

          {preview && (
            <div style={{ marginTop: 14 }} data-testid="preview-result">
              <div className="row" style={{ gap: 10 }}>
                <span className="step-meta">选中</span>
                <strong data-testid="preview-chosen">
                  {preview.candidates.find((c) => c.code === preview.chosen)?.name ?? preview.chosen ?? '未分配'}
                </strong>
                <span className="step-meta">得分 {preview.score.toFixed(4)}</span>
                <span className="step-meta">候选 {preview.eligible_count} 个</span>
              </div>

              {preview.factors.map((f) => (
                <div className="factor" key={f.name}>
                  <span className="name">{FACTOR_LABEL[f.name] ?? f.name}</span>
                  <div className="track" title={f.detail}>
                    <div
                      className="fill"
                      style={{ width: `${Math.max(3, (f.contribution / maxContribution) * 100)}%` }}
                    />
                  </div>
                  <span className="num">{f.contribution.toFixed(3)}</span>
                </div>
              ))}

              <p className="card-sub" style={{ marginTop: 10 }}>
                {preview.reason}
              </p>
              {rejectedGroups.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div className="step-meta">
                    硬过滤淘汰 {preview.rejected.length} 个候选，原因分布：
                  </div>
                  {rejectedGroups.map(([reason, count]) => (
                    <div key={reason} className="step-meta" style={{ marginTop: 2 }}>
                      · {reason}（{count} 个）
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
