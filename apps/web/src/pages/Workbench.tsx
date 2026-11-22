import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Approval, type Task, type WorkflowInfo } from '../api';
import { StatusBadge } from '../components/Layout';

type FormState = {
  title: string;
  workflow_code: string;
  priority: number;
  complexity_hint: number;
  order_id: string;
  quantity: number;
  topic: string;
};

const DEFAULT_FORM: FormState = {
  title: '订单延迟异常处理',
  workflow_code: 'order_delay_exception',
  priority: 1,
  complexity_hint: 5,
  order_id: 'SO-2026-DEMO-01',
  quantity: 420,
  topic: '智能体调度策略',
};

/** 不同工作流的业务参数不同，按工作流切换表单字段 */
const WORKFLOW_PRESET: Record<string, { title: string; hint: string }> = {
  order_delay_exception: { title: '订单延迟异常处理', hint: '填写订单号与数量' },
  literature_review: { title: '文献综述生成', hint: '填写研究主题' },
};

export function Workbench() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  useEffect(() => {
    api
      .listWorkflows()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [taskRows, approvalRows] = await Promise.all([api.listTasks(), api.listApprovals()]);
      setTasks(taskRows);
      setApprovals(approvalRows);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const isResearch = form.workflow_code === 'literature_review';
      const task = await api.createTask({
        title: `${form.title} ${new Date().toLocaleTimeString('zh-CN')}`,
        workflow_code: form.workflow_code,
        priority: form.priority,
        complexity_hint: form.complexity_hint,
        payload: isResearch
          ? { topic: form.topic }
          : { order_id: form.order_id, quantity: form.quantity },
      });
      await refresh();
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
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '审批失败');
    } finally {
      setBusy(false);
    }
  }

  const running = tasks.filter((t) => ['queued', 'running'].includes(t.status)).length;
  const waiting = tasks.filter((t) => t.status === 'waiting_approval').length;
  const succeeded = tasks.filter((t) => t.status === 'succeeded').length;
  const finished = tasks.filter((t) => ['succeeded', 'failed', 'canceled'].includes(t.status)).length;
  const successRate = finished ? Math.round((succeeded / finished) * 100) : 0;

  return (
    <>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="label">任务总数</div>
          <div className="value">{tasks.length}</div>
        </div>
        <div className="kpi">
          <div className="label">进行中</div>
          <div className="value">{running}</div>
        </div>
        <div className="kpi">
          <div className="label">待审批</div>
          <div className="value" style={{ color: waiting ? 'var(--waiting)' : undefined }}>
            {waiting}
          </div>
        </div>
        <div className="kpi">
          <div className="label">成功率</div>
          <div className="value">{successRate}%</div>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}

      {approvals.length > 0 && (
        <div className="card">
          <h2 className="card-title">待我审批</h2>
          <p className="card-sub">审批通过后，运行会从暂停处继续执行。</p>
          {approvals.map((a) => (
            <div
              key={a.id}
              className="row"
              style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>运行 {a.run_id.slice(0, 8)}</div>
                <div className="step-meta">
                  角色要求 {a.assignee_role} · 创建于 {new Date(a.created_at).toLocaleString('zh-CN')}
                </div>
              </div>
              <div className="row">
                <button onClick={() => navigate(`/runs/${a.run_id}`)}>查看</button>
                <button className="primary" disabled={busy} onClick={() => approve(a.id)}>
                  通过
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2 className="card-title">快捷发起</h2>
          <p className="card-sub">填写业务参数后立即进入调度，分配结果可在详情页看到。</p>
          <form onSubmit={createTask}>
            <div className="field">
              <label className="field">任务标题</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field">工作流</label>
              <select
                value={form.workflow_code}
                onChange={(e) => {
                  const code = e.target.value;
                  const preset = WORKFLOW_PRESET[code];
                  setForm({
                    ...form,
                    workflow_code: code,
                    title: preset?.title ?? form.title,
                  });
                }}
              >
                {(workflows.length ? workflows : [{ code: form.workflow_code, name: form.workflow_code }]).map(
                  (w) => (
                    <option key={w.code} value={w.code}>
                      {w.name}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="grid-2" style={{ gap: 10, marginTop: 10 }}>
              <div>
                <label className="field">优先级（1 最高）</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="field">复杂度（1-5）</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.complexity_hint}
                  onChange={(e) => setForm({ ...form, complexity_hint: Number(e.target.value) })}
                />
              </div>
            </div>
            {form.workflow_code === 'literature_review' ? (
              <div className="field" style={{ marginTop: 10 }}>
                <label className="field">研究主题</label>
                <input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
              </div>
            ) : (
              <div className="grid-2" style={{ gap: 10, marginTop: 10 }}>
                <div>
                  <label className="field">订单号</label>
                  <input
                    data-testid="order-id"
                    value={form.order_id}
                    onChange={(e) => setForm({ ...form, order_id: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field">数量</label>
                  <input
                    data-testid="order-quantity"
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                  />
                </div>
              </div>
            )}
            <button className="primary" type="submit" style={{ marginTop: 14 }} disabled={busy} data-testid="create-task">
              {busy ? '提交中…' : '发起任务'}
            </button>
          </form>
        </div>

        <div className="card">
          <h2 className="card-title">最近任务</h2>
          <p className="card-sub">点击任意行查看调度依据与执行轨迹。</p>
          {tasks.length === 0 ? (
            <div className="empty">还没有任务。左侧发起一个试试。</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th>优先级</th>
                </tr>
              </thead>
              <tbody>
                {tasks.slice(0, 8).map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/tasks/${t.id}`)}>
                    <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.title}
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>P{t.priority}</td>
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
