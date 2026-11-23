import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type FieldSchema, type SkillInfo } from '../api';
import { SchemaForm } from '../components/SchemaForm';

const TYPE_OPTIONS = [
  { value: 'builtin', label: '内置函数' },
  { value: 'http', label: 'HTTP' },
];

const CATEGORY_OPTIONS = [
  { value: 'data', label: '数据查询' },
  { value: 'analysis', label: '预测分析' },
  { value: 'rule_check', label: '规则校验' },
  { value: 'notify', label: '消息通知' },
  { value: 'document', label: '文档解析' },
  { value: 'external', label: '外部系统' },
  { value: 'ai', label: 'AI 能力' },
];

/** 新建技能表单的默认输入 Schema：两个示例字段，用户可再改 JSON */
const DEFAULT_SCHEMA = JSON.stringify(
  {
    order_id: { type: 'string', required: true, label: '订单号', placeholder: '1000' },
    note: { type: 'string', label: '备注' },
  },
  null,
  2,
);

export function Skills() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SkillInfo[]>([]);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registry, setRegistry] = useState<{ function: string; doc: string }[]>([]);

  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'external',
    type: 'http',
    description: '',
    function: '',
    url: 'https://api.example.com/quote?carrier={{carrier}}',
    method: 'GET',
    mock: true,
    mockDelayMs: '120',
    mockResponse: '{"ok": true, "carrier": "{{carrier}}", "quote": 128.5, "source": "mock"}',
    timeoutSec: '30',
    schemaText: DEFAULT_SCHEMA,
    testValues: {} as Record<string, string>,
  });

  const load = useCallback(async () => {
    try {
      const data = await api.listSkills({ q: keyword || undefined, type: typeFilter || undefined });
      setItems(data.items);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [keyword, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.builtinRegistry().then(setRegistry).catch(() => setRegistry([]));
  }, []);

  const schema = (() => {
    try {
      return JSON.parse(form.schemaText) as Record<string, FieldSchema>;
    } catch {
      return {};
    }
  })();

  function resetForm() {
    setForm((prev) => ({
      ...prev,
      code: '',
      name: '',
      description: '',
      testValues: {},
    }));
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      let inputSchema: Record<string, unknown> = {};
      try {
        inputSchema = JSON.parse(form.schemaText);
      } catch {
        throw new Error('输入 Schema 不是合法 JSON');
      }

      const config =
        form.type === 'http'
          ? {
              method: form.method,
              url: form.url,
              mock: form.mock,
              mock_delay_ms: Number(form.mockDelayMs) || 0,
              mock_response: form.mockResponse,
            }
          : { function: form.function || form.code };

      const created = await api.createSkill({
        code: form.code.trim(),
        name: form.name.trim(),
        category: form.category,
        type: form.type,
        description: form.description,
        input_schema: inputSchema,
        output_schema: {},
        config,
        timeout_sec: Number(form.timeoutSec) || 30,
      });
      setShowForm(false);
      resetForm();
      await load();
      // 建好就直接进详情页试运行，少一步点击
      navigate(`/skills/${created.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="row">
          <input
            placeholder="搜索技能名称或编码"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 240 }}
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 140 }}>
            <option value="">全部类型</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="step-meta">共 {items.length} 个技能</span>
        </div>
        <button className="primary" onClick={() => setShowForm((v) => !v)} data-testid="new-skill">
          {showForm ? '收起' : '新建技能'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="card-title">新建技能</h3>
          <p className="card-sub">
            HTTP 技能默认走 Mock：不联网、不需要 Key，响应内容按你填的模板返回。
            关掉 Mock 才会真的发请求，届时受 SSRF 防护与域名白名单约束。
          </p>

          <div className="grid-2" style={{ gap: 12 }}>
            <div>
              <label className="field">技能编码（小写字母开头，可含数字与下划线）</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="carrier_quote"
                data-testid="skill-code"
              />
            </div>
            <div>
              <label className="field">显示名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="承运商实时报价"
                data-testid="skill-name"
              />
            </div>
            <div>
              <label className="field">类型</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                data-testid="skill-type"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field">分类</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="field">说明</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="查询承运商报价，用于运价核对"
              />
            </div>
          </div>

          {form.type === 'http' ? (
            <div className="grid-2" style={{ gap: 12, marginTop: 12 }}>
              <div>
                <label className="field">请求方法</label>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {['GET', 'POST', 'PUT'].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field">Mock 开关</label>
                <select
                  value={form.mock ? 'true' : 'false'}
                  onChange={(e) => setForm({ ...form, mock: e.target.value === 'true' })}
                  data-testid="skill-mock"
                >
                  <option value="true">Mock（离线，不联网）</option>
                  <option value="false">真实请求（受 SSRF 防护）</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="field">URL（可用 {'{{字段}}'} 占位）</label>
                <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              </div>
              <div>
                <label className="field">Mock 延迟（毫秒，用于展示耗时）</label>
                <input
                  type="number"
                  value={form.mockDelayMs}
                  onChange={(e) => setForm({ ...form, mockDelayMs: e.target.value })}
                />
              </div>
              <div>
                <label className="field">超时（秒）</label>
                <input
                  type="number"
                  value={form.timeoutSec}
                  onChange={(e) => setForm({ ...form, timeoutSec: e.target.value })}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="field">Mock 响应（JSON，支持 {'{{字段}}'} 占位）</label>
                <textarea
                  className="mono"
                  rows={5}
                  value={form.mockResponse}
                  onChange={(e) => setForm({ ...form, mockResponse: e.target.value })}
                  style={{ width: '100%', fontSize: 12, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <label className="field">内置函数</label>
              <select
                value={form.function}
                onChange={(e) => setForm({ ...form, function: e.target.value })}
                data-testid="skill-function"
              >
                <option value="">（默认用技能编码）</option>
                {registry.map((r) => (
                  <option key={r.function} value={r.function}>
                    {r.function} —— {r.doc}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <label className="field">输入 Schema（JSON，用于生成试运行表单）</label>
            <textarea
              className="mono"
              rows={6}
              value={form.schemaText}
              onChange={(e) => setForm({ ...form, schemaText: e.target.value })}
              style={{ width: '100%', fontSize: 12, padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}
            />
          </div>

          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <span className="step-meta">建好后会直接进入详情页，可以立刻试运行</span>
            <button className="primary" disabled={busy || !form.code || !form.name} onClick={() => void create()} data-testid="create-skill">
              {busy ? '创建中…' : '创建技能'}
            </button>
          </div>
        </div>
      )}

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">技能总数</div>
          <div className="value">{items.length}</div>
        </div>
        <div className="kpi">
          <div className="label">HTTP 技能</div>
          <div className="value">{items.filter((i) => i.type === 'http').length}</div>
        </div>
        <div className="kpi">
          <div className="label">被引用合计</div>
          <div className="value">{items.reduce((sum, i) => sum + i.reference_count, 0)}</div>
        </div>
        <div className="kpi">
          <div className="label">平均成功率</div>
          <div className="value">
            {(() => {
              const measured = items.filter((i) => i.success_rate !== null);
              if (measured.length === 0) return '—';
              const avg = measured.reduce((s, i) => s + (i.success_rate ?? 0), 0) / measured.length;
              return `${(avg * 100).toFixed(1)}%`;
            })()}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <div className="empty">还没有技能，点右上角「新建技能」开始</div>
        </div>
      ) : (
        <div className="skill-grid">
          {items.map((skill) => (
            <Link key={skill.code} to={`/skills/${skill.code}`} className="card skill-card" data-testid="skill-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{skill.name}</strong>
                <span className="badge queued">{skill.type_label}</span>
              </div>
              <div className="step-meta mono">{skill.code} · v{skill.version}</div>
              <p className="card-sub" style={{ margin: '8px 0 10px' }}>
                {skill.description || '（无说明）'}
              </p>
              <div className="row" style={{ gap: 14 }}>
                <span className="step-meta">{skill.category_label}</span>
                <span className="step-meta">
                  平均耗时 {skill.avg_ms === null ? '—' : `${skill.avg_ms} ms`}
                </span>
                <span className="step-meta">
                  成功率 {skill.success_rate === null ? '—' : `${(skill.success_rate * 100).toFixed(0)}%`}
                </span>
                <span className="step-meta">被引用 {skill.reference_count}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="card-title">字段预览</h3>
          <p className="card-sub">上面的输入 Schema 会渲染成下面这张表单（试运行时用）。</p>
          <SchemaForm
            schema={schema}
            values={form.testValues}
            onChange={(v) => setForm({ ...form, testValues: v })}
            testIdPrefix="preview"
          />
        </div>
      )}
    </>
  );
}
