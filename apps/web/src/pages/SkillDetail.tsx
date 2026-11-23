import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  type AuditLogInfo,
  type SkillInfo,
  type SkillTestResult,
} from '../api';
import { SchemaForm, coerceValues } from '../components/SchemaForm';
import { ERROR_CODE_LABEL, label } from '../labels';

export function SkillDetail() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [useMock, setUseMock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SkillTestResult | null>(null);
  const [history, setHistory] = useState<AuditLogInfo[]>([]);

  const load = useCallback(async () => {
    try {
      const detail = await api.getSkill(code);
      setSkill(detail);
      // 默认值：能填的先用 placeholder 里的示例，省得每次手打
      setValues((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const seeded: Record<string, string> = {};
        for (const [key, spec] of Object.entries(detail.input_schema ?? {})) {
          if (spec.placeholder) seeded[key] = String(spec.placeholder);
        }
        return seeded;
      });
      const logs = await api.listAuditLogs({
        action: 'skill.create,skill.version',
        q: code,
        limit: 20,
      });
      setHistory(logs.items.filter((row) => row.resource_id === code));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    setBusy(true);
    setError('');
    try {
      const inputs = coerceValues(skill?.input_schema ?? {}, values);
      const res = await api.testSkill(code, inputs, skill?.type === 'http' ? useMock : undefined);
      setResult(res);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '执行失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`确认删除技能「${skill?.name ?? code}」？被引用的技能不允许删除。`)) return;
    setBusy(true);
    try {
      await api.deleteSkill(code);
      navigate('/skills');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  if (error && !skill) return <div className="alert">{error}</div>;
  if (!skill) return <div className="empty">加载中…</div>;

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">
              {skill.name}{' '}
              <span className="badge queued">{skill.type_label}</span>{' '}
              <span className="badge succeeded">v{skill.version}</span>
            </h2>
            <p className="card-sub">
              <span className="mono">{skill.code}</span> · {skill.category_label} ·{' '}
              {skill.description || '（无说明）'}
            </p>
          </div>
          <div className="chart-actions">
            <Link to="/skills" className="step-meta">
              返回技能库
            </Link>
            <button className="danger" disabled={busy} onClick={() => void remove()}>
              删除
            </button>
          </div>
        </div>

        <div className="grid-4">
          <div className="kpi">
            <div className="label">调用次数</div>
            <div className="value">{skill.runs}</div>
          </div>
          <div className="kpi">
            <div className="label">成功率</div>
            <div className="value">
              {skill.success_rate === null ? '—' : `${(skill.success_rate * 100).toFixed(1)}%`}
            </div>
          </div>
          <div className="kpi">
            <div className="label">平均耗时</div>
            <div className="value">{skill.avg_ms === null ? '—' : `${skill.avg_ms} ms`}</div>
          </div>
          <div className="kpi">
            <div className="label">被引用</div>
            <div className="value">{skill.reference_count}</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">试运行</h3>
          <p className="card-sub">
            表单由输入 Schema 生成；执行一次会真实写入调用记录（耗时与成功率就是从这里来的）。
          </p>

          <SchemaForm schema={skill.input_schema} values={values} onChange={setValues} testIdPrefix="test" />

          {skill.type === 'http' && (
            <div className="row" style={{ marginTop: 12 }}>
              <label className="field" style={{ margin: 0 }}>
                Mock
              </label>
              <select
                value={useMock ? 'true' : 'false'}
                onChange={(e) => setUseMock(e.target.value === 'true')}
                style={{ width: 220 }}
                data-testid="test-mock"
              >
                <option value="true">Mock（不联网）</option>
                <option value="false">真实请求（受 SSRF 防护）</option>
              </select>
              <span className="step-meta">仅本次试运行生效，不改技能配置</span>
            </div>
          )}

          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="primary" disabled={busy} onClick={() => void run()} data-testid="run-skill">
              {busy ? '执行中…' : '执行'}
            </button>
          </div>

          {result && (
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className={`badge ${result.ok ? 'succeeded' : 'failed'}`}>
                  {result.ok ? '成功' : '失败'}
                </span>
                <span className="step-meta">模式 {result.mode}</span>
                <span className="step-meta">耗时 {result.duration_ms} ms</span>
                {!result.ok && (
                  <span className="step-meta" style={{ color: 'var(--danger)' }}>
                    {label(ERROR_CODE_LABEL, result.error_code)} · {result.error}
                  </span>
                )}
              </div>
              {result.ok && (
                <pre className="audit-json mono" style={{ marginTop: 10 }}>
                  {JSON.stringify(result.output, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="card-title">配置（已脱敏）</h3>
          <p className="card-sub">
            密钥只以环境变量名引用，接口永远不回显明文。
            {skill.type === 'http' && (
              <>
                {' '}当前模式：
                <strong>{skill.mock ? 'Mock（离线）' : '真实请求'}</strong>。
              </>
            )}
          </p>
          <pre className="audit-json mono">{JSON.stringify(skill.config ?? {}, null, 2)}</pre>

          <h3 className="card-title" style={{ marginTop: 16 }}>
            输出 Schema
          </h3>
          <pre className="audit-json mono" style={{ maxHeight: 160 }}>
            {JSON.stringify(skill.output_schema ?? {}, null, 2)}
          </pre>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">版本历史</h3>
          <p className="card-sub">
            改配置是"发新版本"，不是原地覆盖。历史来自审计记录，可追溯到人。
          </p>
          {history.length === 0 ? (
            <div className="empty">暂无版本变更</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作</th>
                  <th>版本</th>
                  <th>操作者</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} style={{ cursor: 'default' }}>
                    <td className="step-meta">
                      {row.created_at ? new Date(row.created_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
                    </td>
                    <td>{row.action_label}</td>
                    <td className="mono">v{(row.after as { version?: number } | null)?.version ?? '—'}</td>
                    <td>{row.actor_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 className="card-title">被引用</h3>
          <p className="card-sub">被已发布版本引用时不允许删除——否则线上会指向空实现。</p>
          {(skill.references ?? []).length === 0 ? (
            <div className="empty">当前没有引用，可以安全删除</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>类型</th>
                  <th>名称</th>
                  <th>版本</th>
                </tr>
              </thead>
              <tbody>
                {(skill.references ?? []).map((ref) => (
                  <tr key={`${ref.kind}-${ref.code}-${ref.versions.join('-')}`} style={{ cursor: 'default' }}>
                    <td>{ref.kind === 'agent' ? '智能体' : '工作流'}</td>
                    <td>{ref.name}</td>
                    <td className="mono">{ref.versions.map((v) => `v${v}`).join('、')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="card-title" style={{ marginTop: 16 }}>
            最近执行
          </h3>
          {(skill.recent_runs ?? []).length === 0 ? (
            <div className="empty">还没有执行记录</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>结果</th>
                  <th>耗时</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {(skill.recent_runs ?? []).map((run) => (
                  <tr key={run.id} style={{ cursor: 'default' }}>
                    <td className="step-meta">
                      {run.created_at ? new Date(run.created_at).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}
                    </td>
                    <td>
                      <span className={`badge ${run.ok ? 'succeeded' : 'failed'}`}>
                        {run.ok ? '成功' : label(ERROR_CODE_LABEL, run.error_code)}
                      </span>
                    </td>
                    <td>{run.duration_ms} ms</td>
                    <td className="step-meta">{run.source === 'test' ? '试运行' : '工作流'}</td>
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
