import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  type AgentDetail as AgentDetailData,
  type AgentTestResult,
  type AgentVersionInfo,
  type SkillInfo,
} from '../api';
import { toast } from '../components/Toast';
import { CAPABILITY_LABEL, ERROR_CODE_LABEL, label, STAGE_LABEL, STATUS_TEXT } from '../labels';

const SAMPLE_INPUT = '{\n  "carrier": "Standard Class",\n  "weight_kg": 12\n}';

function diffVersions(from: AgentVersionInfo, to: AgentVersionInfo) {
  const fromLines = (from.system_prompt ?? '').split('\n');
  const toLines = (to.system_prompt ?? '').split('\n');
  const firstDiff = (() => {
    const max = Math.max(fromLines.length, toLines.length);
    for (let i = 0; i < max; i += 1) {
      if ((fromLines[i] ?? '') !== (toLines[i] ?? '')) return i + 1;
    }
    return 0;
  })();
  const skillsAdded = (to.skill_ids ?? []).filter((c) => !(from.skill_ids ?? []).includes(c));
  const skillsRemoved = (from.skill_ids ?? []).filter((c) => !(to.skill_ids ?? []).includes(c));
  return {
    promptChanged: firstDiff > 0,
    firstDiffLine: firstDiff,
    fromLines: fromLines.length,
    toLines: toLines.length,
    skillsAdded,
    skillsRemoved,
  };
}

export function AgentDetail() {
  const { code = '' } = useParams();
  const [agent, setAgent] = useState<AgentDetailData | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 编辑区：默认载入草稿，没有草稿就载入已发布版本
  const [prompt, setPrompt] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [changelog, setChangelog] = useState('');

  // 在线测试
  const [testInput, setTestInput] = useState(SAMPLE_INPUT);
  const [useMock, setUseMock] = useState(true);
  const [testResult, setTestResult] = useState<AgentTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // 版本对比
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [diffTo, setDiffTo] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.getAgent(code);
      setAgent(detail);
      const base = detail.draft ?? detail.published;
      setPrompt(base?.system_prompt ?? '');
      setSelected(base?.skill_ids ?? []);
      if (detail.versions.length >= 2 && diffFrom === null) {
        setDiffFrom(detail.versions[1].version);
        setDiffTo(detail.versions[0].version);
      }
      return detail;
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      return null;
    }
    // diffFrom 故意不入依赖：只在首次装载时给个默认对比
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .listSkills()
      .then((res) => setSkills(res.items))
      .catch(() => setSkills([]));
  }, []);

  async function save(publish: boolean) {
    setBusy(true);
    setError('');
    try {
      await api.publishAgentVersion(code, {
        system_prompt: prompt,
        skill_ids: selected,
        changelog: changelog || (publish ? '发布新版本' : '保存草稿'),
        publish,
        model_config: { temperature: 0.2 },
        io_schema: {},
        guardrails: { max_steps: 8 },
      });
      setChangelog('');
      await load();
      toast.success(
        publish ? '已发布为新版本：执行器从下一个运行开始使用它' : '草稿已保存（不影响线上）',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const parsed = JSON.parse(testInput || '{}') as Record<string, unknown>;
      const res = await api.testAgent(code, parsed, useMock);
      setTestResult(res);
      if (!res.ok) toast.error(res.error ?? '测试失败');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTesting(false);
    }
  }

  const diff = useMemo(() => {
    if (!agent || diffFrom === null || diffTo === null) return null;
    const from = agent.versions.find((v) => v.version === diffFrom);
    const to = agent.versions.find((v) => v.version === diffTo);
    if (!from || !to) return null;
    return { from, to, ...diffVersions(from, to) };
  }, [agent, diffFrom, diffTo]);

  const capabilityText = useMemo(() => {
    if (!agent) return '—';
    if (agent.capabilities.length === 0) return '—';
    // 能力标签是调度键（英文编码），展示时优先翻译成技能中文名：
    // 让用户在详情页看到"承运商实时报价"，而不是 carrier_quote
    const byCode = new Map(skills.map((skill) => [skill.code, skill.name]));
    return agent.capabilities
      .map((code) => byCode.get(code) ?? CAPABILITY_LABEL[code] ?? code)
      .join('、');
  }, [agent, skills]);

  if (error && !agent) return <div className="alert">{error}</div>;
  if (!agent) return <div className="empty">加载中…</div>;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">
              {agent.name}{' '}
              <span className="badge queued">{agent.tier_label}</span>{' '}
              {agent.published ? (
                <span className="badge succeeded">已发布 v{agent.published.version}</span>
              ) : (
                <span className="badge pending">仅草稿</span>
              )}
            </h2>
            <p className="card-sub">
              <span className="mono">{agent.code}</span> · {label(STAGE_LABEL, agent.stage)} ·{' '}
              {agent.description || '（无说明）'}
            </p>
          </div>
          <Link to="/agents" className="step-meta">
            返回智能体列表
          </Link>
        </div>
        <div className="grid-4">
          <div className="kpi">
            <div className="label">能力标签</div>
            <div className="value" style={{ fontSize: 15 }}>
              {capabilityText}
            </div>
          </div>
          <div className="kpi">
            <div className="label">绑定技能</div>
            <div className="value">{agent.skills.length}</div>
          </div>
          <div className="kpi">
            <div className="label">成功率（种子值）</div>
            <div className="value">{(agent.success_rate * 100).toFixed(0)}%</div>
          </div>
          <div className="kpi">
            <div className="label">均价 / P95</div>
            <div className="value" style={{ fontSize: 16 }}>
              ${agent.avg_cost_usd.toFixed(4)} · {agent.p95_latency_ms}ms
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">提示词与技能绑定</h3>
          <p className="card-sub">
            保存草稿不影响线上；发布后执行器锁定新版本，并归档上一个已发布版本。
          </p>

          <label className="field">系统提示词</label>
          <textarea
            rows={8}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{ width: '100%', fontSize: 13, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}
            data-testid="edit-prompt"
          />

          <label className="field" style={{ marginTop: 12 }}>
            绑定技能
          </label>
          <div className="row" style={{ gap: 8, maxHeight: 120, overflow: 'auto' }}>
            {skills.map((skill) => {
              const checked = selected.includes(skill.code);
              return (
                <button
                  key={skill.code}
                  type="button"
                  className={checked ? 'primary' : 'ghost'}
                  onClick={() =>
                    setSelected(checked ? selected.filter((c) => c !== skill.code) : [...selected, skill.code])
                  }
                  data-testid={`edit-bind-${skill.code}`}
                >
                  {checked ? '✓ ' : ''}
                  {skill.name}
                </button>
              );
            })}
          </div>

          <label className="field" style={{ marginTop: 12 }}>
            变更说明
          </label>
          <input
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            placeholder="补充谈判要点要求"
            data-testid="edit-changelog"
          />

          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button disabled={busy} onClick={() => void save(false)} data-testid="save-draft">
              保存草稿
            </button>
            <button className="primary" disabled={busy} onClick={() => void save(true)} data-testid="publish-version">
              {busy ? '提交中…' : '发布版本'}
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">在线测试</h3>
          <p className="card-sub">
            逐个执行绑定技能（真实计时），再把输入与技能结果交给模型。轨迹里每一步都可以展开。
          </p>

          <label className="field">输入（JSON）</label>
          <textarea
            rows={6}
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            className="mono"
            style={{ width: '100%', fontSize: 12, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}
            data-testid="test-input"
          />

          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <div className="row">
              <label className="field" style={{ margin: 0 }}>
                模型
              </label>
              <select
                value={useMock ? 'true' : 'false'}
                onChange={(e) => setUseMock(e.target.value === 'true')}
                style={{ width: 200 }}
                data-testid="test-model"
              >
                <option value="true">Mock（离线确定性）</option>
                <option value="false">真实模型（DeepSeek）</option>
              </select>
            </div>
            <button className="primary" disabled={testing} onClick={() => void runTest()} data-testid="run-agent-test">
              {testing ? '执行中…' : '执行测试'}
            </button>
          </div>

          {testResult && (
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 12 }}>
                <span className={`badge ${testResult.ok ? 'succeeded' : 'failed'}`}>
                  {testResult.ok ? '成功' : '失败'}
                </span>
                <span className="step-meta">
                  版本 v{testResult.version}（{testResult.version_status === 'published' ? '已发布' : '草稿'}）
                </span>
                <span className="step-meta">总耗时 {testResult.duration_ms} ms</span>
                <span className="step-meta">{testResult.tokens} tokens</span>
                <span className="step-meta">${testResult.cost_usd.toFixed(6)}</span>
              </div>
              {testResult.note && <div className="step-meta" style={{ marginTop: 6 }}>{testResult.note}</div>}

              <div className="timeline" style={{ marginTop: 12 }}>
                {testResult.trace.map((step, index) => (
                  <div key={`${step.name}-${index}`} className={`step ${step.ok ? 'succeeded' : 'failed'}`} data-testid="trace-step">
                    <div className="step-head">
                      <span className="step-node">
                        {step.kind === 'tool' ? '工具' : '模型'} · {step.label}
                      </span>
                      <span className="step-meta">
                        {step.duration_ms} ms · {step.tokens} tokens
                      </span>
                    </div>
                    {step.error ? (
                      <div className="step-meta" style={{ color: 'var(--danger)' }}>
                        {label(ERROR_CODE_LABEL, step.error_code)} · {step.error}
                      </div>
                    ) : (
                      step.output && (
                        <pre className="audit-json mono" style={{ maxHeight: 140 }}>
                          {JSON.stringify(step.output, null, 2)}
                        </pre>
                      )
                    )}
                  </div>
                ))}
              </div>

              {testResult.output && (
                <>
                  <label className="field" style={{ marginTop: 12 }}>
                    模型结论
                  </label>
                  <pre className="audit-json mono" data-testid="test-output">
                    {testResult.output}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">版本历史</h3>
          <p className="card-sub">运行锁定版本：已发布版本不可修改，只能再发新版本。</p>
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>状态</th>
                <th>技能</th>
                <th>提示词</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {agent.versions.map((version) => (
                <tr key={version.id} style={{ cursor: 'default' }} data-testid="version-row">
                  <td className="mono">v{version.version}</td>
                  <td>
                    <span
                      className={`badge ${version.status === 'published' ? 'succeeded' : version.status === 'draft' ? 'pending' : 'skipped'}`}
                    >
                      {version.status === 'published' ? '已发布' : version.status === 'draft' ? '草稿' : '已归档'}
                    </span>
                  </td>
                  <td>{(version.skill_ids ?? []).length}</td>
                  <td className="step-meta">{version.prompt_length ?? version.system_prompt.length} 字</td>
                  <td className="step-meta">{version.changelog || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 className="card-title">版本对比</h3>
          <p className="card-sub">对比提示词与技能绑定的差异；只比内容，不比时间。</p>
          <div className="row" style={{ marginBottom: 10 }}>
            <select
              value={diffFrom ?? ''}
              onChange={(e) => setDiffFrom(Number(e.target.value))}
              style={{ width: 130 }}
            >
              <option value="">旧版本</option>
              {agent.versions.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </select>
            <span className="step-meta">→</span>
            <select value={diffTo ?? ''} onChange={(e) => setDiffTo(Number(e.target.value))} style={{ width: 130 }}>
              <option value="">新版本</option>
              {agent.versions.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </select>
          </div>

          {diff === null ? (
            <div className="empty">选两个版本开始对比</div>
          ) : (
            <table>
              <tbody>
                <tr style={{ cursor: 'default' }}>
                  <td>提示词</td>
                  <td>
                    {diff.promptChanged ? (
                      <>
                        有变化：第 <strong>{diff.firstDiffLine}</strong> 行起不同；
                        行数 {diff.fromLines} → {diff.toLines}
                      </>
                    ) : (
                      '无变化'
                    )}
                  </td>
                </tr>
                <tr style={{ cursor: 'default' }}>
                  <td>新增技能</td>
                  <td className="mono">{diff.skillsAdded.length ? diff.skillsAdded.join('、') : '—'}</td>
                </tr>
                <tr style={{ cursor: 'default' }}>
                  <td>移除技能</td>
                  <td className="mono">{diff.skillsRemoved.length ? diff.skillsRemoved.join('、') : '—'}</td>
                </tr>
                <tr style={{ cursor: 'default' }}>
                  <td>变更说明</td>
                  <td className="step-meta">
                    {diff.from.changelog || '—'} → {diff.to.changelog || '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          <h3 className="card-title" style={{ marginTop: 16 }}>
            最近运行
          </h3>
          {agent.recent_steps.length === 0 ? (
            <div className="empty">还没有被调度执行过</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>运行</th>
                  <th>状态</th>
                  <th>tokens</th>
                </tr>
              </thead>
              <tbody>
                {agent.recent_steps.map((step) => (
                  <tr key={step.step_id} style={{ cursor: 'default' }}>
                    <td className="step-meta">
                      {step.started_at ? new Date(step.started_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
                    </td>
                    <td>
                      <Link to={`/runs/${step.run_id}`} className="mono">
                        {step.run_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{label(STATUS_TEXT, step.status)}</td>
                    <td>{step.tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
