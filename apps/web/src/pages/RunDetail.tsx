import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Approval, type Run } from '../api';
import { StatusBadge } from '../components/Layout';

export function RunDetail() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<Run | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const current = await api.getRun(id);
      setRun(current);
      if (current.status === 'waiting_approval') {
        const all = await api.listApprovals();
        setApprovals(all.filter((a) => a.run_id === id && a.status === 'pending'));
      } else {
        setApprovals([]);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function decide(approvalId: string, decision: 'approved' | 'rejected') {
    setBusy(true);
    try {
      await api.decide(approvalId, decision, decision === 'approved' ? '界面审批通过' : '界面驳回');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '审批失败');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="alert">{error}</div>;
  if (!run) return <div className="empty">加载中…</div>;

  const steps = run.steps ?? [];
  const duration =
    run.started_at && run.finished_at
      ? `${((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s`
      : run.started_at
        ? '进行中'
        : '—';

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 className="card-title" style={{ fontSize: 17 }}>
              运行 {run.id.slice(0, 12)}
            </h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              工作流 v{run.workflow_version ?? '—'} · 触发 {run.trigger} · 耗时 {duration} · 成本 $
              {Number(run.cost_usd).toFixed(5)}
            </p>
          </div>
          <div className="row">
            <StatusBadge status={run.status} />
          </div>
        </div>

        {run.error_code && (
          <div className="alert">错误码：{run.error_code}</div>
        )}

        {approvals.length > 0 && (
          <div
            className="row"
            style={{
              marginTop: 14,
              padding: 12,
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 8,
              justifyContent: 'space-between',
            }}
          >
            <div>
              <strong style={{ fontSize: 13 }}>该运行正在等待人工审批</strong>
              <div className="step-meta">批准后将从中断的节点继续执行。</div>
            </div>
            <div className="row">
              <button className="danger" disabled={busy} onClick={() => decide(approvals[0].id, 'rejected')}>
                驳回
              </button>
              <button className="primary" disabled={busy} onClick={() => decide(approvals[0].id, 'approved')}>
                通过
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">执行轨迹</h3>
        <p className="card-sub">共 {steps.length} 个节点，点击节点查看输入输出。</p>

        {steps.length === 0 ? (
          <div className="empty">运行尚未产生步骤</div>
        ) : (
          <div className="timeline">
            {steps.map((step) => (
              <div className={`step ${step.status}`} key={step.id}>
                <div className="step-head">
                  <span className="step-node">{step.node_id}</span>
                  <span className="mono">{step.node_type}</span>
                  <StatusBadge status={step.status} />
                  {step.tokens > 0 && <span className="step-meta">{step.tokens} tokens</span>}
                  {Number(step.cost_usd) > 0 && (
                    <span className="step-meta">${Number(step.cost_usd).toFixed(5)}</span>
                  )}
                  <button
                    className="ghost"
                    style={{ marginLeft: 'auto', fontSize: 12 }}
                    onClick={() => setOpenStep(openStep === step.id ? null : step.id)}
                  >
                    {openStep === step.id ? '收起' : '查看'}
                  </button>
                </div>

                {typeof step.output?.text === 'string' && (
                  <div className="step-meta" style={{ marginTop: 6 }}>
                    {step.output.text as string}
                  </div>
                )}

                {openStep === step.id && (
                  <pre className="json">
                    {JSON.stringify({ input: step.input, output: step.output, error: step.error }, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
