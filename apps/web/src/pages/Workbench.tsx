import { useCallback, useEffect, useMemo, useState } from 'react';
import { label, WORKFLOW_LABEL } from '../labels';
import { useNavigate } from 'react-router-dom';
import { api, type Approval, type FieldSchema, type Task, type WorkflowInfo } from '../api';
import { StatusBadge } from '../components/Layout';

const PAGE_SIZE = 8;

const TABS: { key: string; label: string; status?: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中', status: 'queued,running,waiting_approval' },
  { key: 'approval', label: '待审批', status: 'waiting_approval' },
  { key: 'failed', label: '失败', status: 'failed,canceled' },
  { key: 'done', label: '已完成', status: 'succeeded' },
];

export function Workbench() {
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [riskFirst, setRiskFirst] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [workflowCode, setWorkflowCode] = useState('order_delay_exception');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [priority, setPriority] = useState(3);
  const [complexity, setComplexity] = useState(3);

  const currentWorkflow = useMemo(
    () => workflows.find((w) => w.code === workflowCode) ?? null,
    [workflows, workflowCode],
  );

  const fields = useMemo(() => {
    const schema = currentWorkflow?.variables_schema ?? {};
    return Object.entries(schema).map(([key, spec]) => ({ key, spec: spec as FieldSchema }));
  }, [currentWorkflow]);

  const loadList = useCallback(async () => {
    const status = TABS.find((t) => t.key === tab)?.status;
    try {
      const result = await api.listTasks({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        status,
        q: search || undefined,
        order: riskFirst ? 'risk' : 'created_at',
      });
      setTasks(result.items);
      setTotal(result.total);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [tab, page, search, riskFirst]);

  const loadApprovals = useCallback(async () => {
    try {
      const rows = await api.listApprovals();
      setApprovals(Array.isArray(rows) ? rows : []);
    } catch {
      /* 审批列表失败不阻塞主列表 */
    }
  }, []);

  useEffect(() => {
    api
      .listWorkflows()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setWorkflows(list);
        if (list.length > 0) {
          setWorkflowCode((prev) => (list.some((w) => w.code === prev) ? prev : list[0].code));
        }
      })
      .catch(() => setWorkflows([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadList().finally(() => setLoading(false));
    const timer = setInterval(() => void loadApprovals(), 5000);
    void loadApprovals();
    return () => clearInterval(timer);
  }, [loadList, loadApprovals]);

  // 切换工作流时用 schema 的默认值重置表单
  useEffect(() => {
    const schema = workflows.find((w) => w.code === workflowCode)?.variables_schema ?? {};
    const next: Record<string, string> = {};
    for (const [key, raw] of Object.entries(schema)) {
      const spec = raw as FieldSchema;
      next[key] =
        spec.default !== undefined && spec.default !== null ? String(spec.default) : '';
    }
    setFormValues(next);
  }, [workflowCode, workflows]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(keyword.trim());
  }

  function switchTab(key: string) {
    setTab(key);
    setPage(0);
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const { key, spec } of fields) {
      const raw = formValues[key] ?? '';
      if (raw === '') continue;
      payload[key] = spec.type === 'integer' || spec.type === 'number' ? Number(raw) : raw;
    }
    return payload;
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!currentWorkflow) return;

    const missing = fields.filter(
      ({ key, spec }) => spec.required && !(formValues[key] ?? '').trim(),
    );
    if (missing.length > 0) {
      setError(`请填写：${missing.map((m) => m.spec.label ?? m.key).join('、')}`);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const task = await api.createTask({
        title: `${currentWorkflow.name} ${new Date().toLocaleTimeString('zh-CN')}`,
        workflow_code: currentWorkflow.code,
        priority,
        complexity_hint: complexity,
        payload: buildPayload(),
      });
      await loadList();
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      await api.decide(id, 'approved', '工作台快速审批');
      await Promise.all([loadApprovals(), loadList()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '审批失败');
    } finally {
      setBusy(false);
    }
  }

  const running = tasks.filter((t) => ['queued', 'running'].includes(t.status)).length;
  const waiting = tasks.filter((t) => t.status === 'waiting_approval').length;
  const succeeded = tasks.filter((t) => t.status === 'succeeded').length;
  const finished = tasks.filter((t) =>
    ['succeeded', 'failed', 'canceled'].includes(t.status),
  ).length;
  const successRate = finished ? Math.round((succeeded / finished) * 100) : 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      {error && <div className="alert">{error}</div>}

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">任务总数</div>
          <div className="value">{total}</div>
        </div>
        <div className="kpi">
          <div className="label">进行中</div>
          <div className="value">{running}</div>
        </div>
        <div className="kpi">
          <div className="label">待审批</div>
          <div className="value" style={{ color: waiting ? 'var(--warning)' : undefined }}>
            {approvals.length || waiting}
          </div>
        </div>
        <div className="kpi">
          <div className="label">本页成功率</div>
          <div className="value">{successRate}%</div>
        </div>
      </div>

      {approvals.length > 0 && (
        <div className="card" style={{ borderColor: '#fde68a', background: '#fffdf5' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2 className="card-title">待我审批 · {approvals.length}</h2>
              <p className="card-sub" style={{ marginBottom: 0 }}>
                通过后运行会从暂停处继续执行。
              </p>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {approvals.slice(0, 3).map((a) => (
              <div
                key={a.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  padding: '9px 0',
                  borderTop: '1px solid #f1e8cf',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    运行 {a.run_id.slice(0, 10)}
                  </div>
                  <div className="step-meta">
                    需要 {a.assignee_role} · {new Date(a.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div className="row">
                  <button onClick={() => navigate(`/runs/${a.run_id}`)}>查看</button>
                  <button className="primary" disabled={busy} onClick={() => void approve(a.id)}>
                    通过
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h2 className="card-title">任务</h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              点击任意行查看调度依据与执行轨迹。
            </p>
          </div>
          <div className="row">
            <form onSubmit={submitSearch} className="row" style={{ gap: 8 }}>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索标题或任务 ID"
                style={{ width: 220 }}
              />
              <button type="submit">搜索</button>
            </form>
            <button className="primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? '收起' : '＋ 发起任务'}
            </button>
          </div>
        </div>

        {showForm && currentWorkflow && (
          <form
            onSubmit={createTask}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 16,
              marginBottom: 16,
              background: 'var(--surface-2)',
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: 13 }}>{currentWorkflow.name}</div>
                <div className="step-meta">{currentWorkflow.description}</div>
              </div>
              <select
                value={workflowCode}
                onChange={(e) => setWorkflowCode(e.target.value)}
                style={{ width: 240 }}
              >
                {workflows.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.name}（v{w.published_version}）
                  </option>
                ))}
              </select>
            </div>

            <div className="grid-2" style={{ gap: 12 }}>
              {fields.map(({ key, spec }) => (
                <div key={key}>
                  <label className="field">
                    {spec.label ?? key}
                    {spec.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                  </label>
                  <input
                    data-testid={`field-${key}`}
                    type={spec.type === 'integer' || spec.type === 'number' ? 'number' : 'text'}
                    value={formValues[key] ?? ''}
                    placeholder={spec.placeholder}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div>
                <label className="field">优先级（1 最高）</label>
                <input
                  data-testid="field-priority"
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
                  data-testid="field-complexity"
                  type="number"
                  min={1}
                  max={5}
                  value={complexity}
                  onChange={(e) => setComplexity(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" className="ghost" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button className="primary" type="submit" disabled={busy} data-testid="create-task">
                {busy ? '提交中…' : '发起任务'}
              </button>
            </div>
          </form>
        )}

        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => switchTab(t.key)}
            >
              {t.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button
            className="ghost"
            onClick={() => setRiskFirst((v) => !v)}
            title="按失败 / 待审批优先排序"
          >
            {riskFirst ? '异常优先' : '最新优先'}
          </button>
        </div>

        {loading ? (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="skeleton skeleton-row" key={i} />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty">
            {search ? (
              <>
                没有匹配「{search}」的任务
                <br />
                试试清空搜索条件
              </>
            ) : (
              <>
                还没有任务
                <br />
                点右上角「发起任务」开始
              </>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>优先级</th>
                  <th>工作流</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/tasks/${t.id}`)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ fontWeight: 550, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                      </div>
                      <div className="step-meta mono">{t.id.slice(0, 8)}</div>
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>P{t.priority}</td>
                    <td className="step-meta">
                    {t.workflow_name ?? label(WORKFLOW_LABEL, t.workflow_code)}
                  </td>
                    <td className="step-meta">
                      {new Date(t.created_at).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > PAGE_SIZE && (
          <div className="pager">
            <span>
              共 {total} 条 · 第 {page + 1} / {pageCount} 页
            </span>
            <div className="pages">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                上一页
              </button>
              <button
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
