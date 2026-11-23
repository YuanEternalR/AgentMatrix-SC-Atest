import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type AgentInfo, type SkillInfo } from '../api';
import { TableSkeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { label, STAGE_LABEL } from '../labels';

const TIER_OPTIONS = [
  { value: 'large', label: '大模型' },
  { value: 'small', label: '小模型' },
  { value: 'tool', label: '工具' },
];

export function Agents() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [keyword, setKeyword] = useState('');
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    stage: 'fulfillment',
    tier: 'small',
    description: '',
    capabilities: '',
    systemPrompt: '',
    skillIds: [] as string[],
  });

  const load = useCallback(async () => {
    try {
      const rows = await api.listAgents();
      const filtered = rows.filter((row) => {
        if (stage && row.stage !== stage) return false;
        if (!keyword) return true;
        return row.name.includes(keyword) || row.code.includes(keyword);
      });
      setItems(filtered);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, stage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .listSkills()
      .then((res) => setSkills(res.items))
      .catch(() => setSkills([]));
  }, []);

  /**
   * 绑定/解绑技能时同步能力标签。
   *
   * 为什么联动：新手最容易把"技能编码"和"能力标签"当成一回事，
   * 结果建完智能体、发任务却永远选不到它（能力不匹配）。绑技能时顺手把同名标签带上，
   * 用户想改再改——默认正确，比让用户先理解概念再动手更可靠。
   */
  function toggleSkill(code: string) {
    const bound = form.skillIds.includes(code);
    const tags = form.capabilities
      .split(/[,，\s]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const nextTags = bound ? tags.filter((t) => t !== code) : [...new Set([...tags, code])];
    setForm({
      ...form,
      skillIds: bound ? form.skillIds.filter((c) => c !== code) : [...form.skillIds, code],
      capabilities: nextTags.join(', '),
    });
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const created = await api.createAgent({
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description,
        stage: form.stage,
        model_tier: form.tier,
        capabilities: form.capabilities
          .split(/[,，\s]+/)
          .map((c) => c.trim())
          .filter(Boolean),
        system_prompt: form.systemPrompt,
        skill_ids: form.skillIds,
      });
      setShowForm(false);
      navigate(`/agents/${created.code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  const publishedCount = items.filter((i) => i.published_version !== null).length;

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">智能体总数</div>
          <div className="value">{items.length}</div>
        </div>
        <div className="kpi">
          <div className="label">已发布版本</div>
          <div className="value">{publishedCount}</div>
        </div>
        <div className="kpi">
          <div className="label">仅草稿</div>
          <div className="value">{items.length - publishedCount}</div>
        </div>
        <div className="kpi">
          <div className="label">覆盖阶段</div>
          <div className="value">{new Set(items.map((i) => i.stage)).size} / 8</div>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="row">
          <input
            placeholder="搜索名称或编码"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 220 }}
          />
          <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ width: 150 }}>
            <option value="">全部阶段</option>
            {Object.entries(STAGE_LABEL)
              .filter(([code]) => code !== 'research')
              .map(([code, text]) => (
                <option key={code} value={code}>
                  {text}
                </option>
              ))}
          </select>
        </div>
        <button className="primary" onClick={() => setShowForm((v) => !v)} data-testid="new-agent">
          {showForm ? '收起' : '新建智能体'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="card-title">新建智能体</h3>
          <p className="card-sub">
            新建后是<strong>草稿</strong>状态：可以先在详情页测试，满意再发布。发布前不会影响任何线上运行。
          </p>
          <div className="grid-2" style={{ gap: 12 }}>
            <div>
              <label className="field">编码（小写字母开头）</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="quote-analyst"
                data-testid="agent-code"
              />
            </div>
            <div>
              <label className="field">名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="运价核对智能体"
                data-testid="agent-name"
              />
            </div>
            <div>
              <label className="field">所属阶段</label>
              <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {Object.entries(STAGE_LABEL)
                  .filter(([code]) => code !== 'research')
                  .map(([code, text]) => (
                    <option key={code} value={code}>
                      {text}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="field">模型档位</label>
              <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                {TIER_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field">说明</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="核对承运商报价并给出谈判建议"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field">能力标签（逗号分隔，任务按它路由到本智能体）</label>
              <input
                value={form.capabilities}
                onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
                placeholder="carrier_quote, negotiation"
                data-testid="agent-capabilities"
              />
              <div className="step-meta" style={{ marginTop: 4 }}>
                能力标签是「招聘条件」，技能是「实现方式」：任务声明需要什么能力，系统才按它选人。
                绑定技能会自动带上同名标签，也可以手动改成更业务化的词。
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field">系统提示词</label>
              <textarea
                rows={4}
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                placeholder="你是运价核对专员……"
                style={{ width: '100%', fontSize: 13, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}
                data-testid="agent-prompt"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field">绑定技能</label>
              <div className="row" style={{ gap: 8, maxHeight: 132, overflow: 'auto' }}>
                {skills.map((skill) => {
                  const checked = form.skillIds.includes(skill.code);
                  return (
                    <button
                      key={skill.code}
                      type="button"
                      className={checked ? 'primary' : 'ghost'}
                      onClick={() => toggleSkill(skill.code)}
                      data-testid={`bind-${skill.code}`}
                    >
                      {checked ? '✓ ' : ''}
                      {skill.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button
              className="primary"
              disabled={busy || !form.code || !form.name}
              onClick={() => void create()}
              data-testid="create-agent"
            >
              {busy ? '创建中…' : '创建并进入详情'}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : (
        <table>
          <thead>
            <tr>
              <th>智能体</th>
              <th>阶段</th>
              <th>档位</th>
              <th>已发布</th>
              <th>技能</th>
              <th>成功率</th>
              <th>均价</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((agent) => (
              <tr key={agent.code} data-testid="agent-row">
                <td>
                  <strong style={{ fontSize: 13 }}>{agent.name}</strong>
                  <div className="step-meta mono">{agent.code}</div>
                </td>
                <td>{label(STAGE_LABEL, agent.stage)}</td>
                <td className="step-meta">{agent.tier_label ?? agent.model_tier}</td>
                <td>
                  {agent.published_version === null ? (
                    <span className="badge pending">仅草稿</span>
                  ) : (
                    <span className="badge succeeded">v{agent.published_version}</span>
                  )}
                </td>
                <td>{agent.skill_count ?? 0}</td>
                <td>{(agent.success_rate * 100).toFixed(0)}%</td>
                <td className="mono">${agent.avg_cost_usd.toFixed(4)}</td>
                <td style={{ textAlign: 'right' }}>
                  <Link to={`/agents/${agent.code}`}>
                    <button className="ghost">详情 / 测试</button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        {!loading && items.length === 0 && <div className="empty">没有匹配的智能体</div>}
      </div>
    </>
  );
}
