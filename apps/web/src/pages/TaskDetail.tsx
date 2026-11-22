import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Task } from '../api';
import { StatusBadge } from '../components/Layout';

const FACTOR_LABEL: Record<string, string> = {
  capability: '能力匹配',
  success: '历史成功率',
  load: '空闲度',
  cost: '成本效率',
  latency: '时延表现',
  affinity: '阶段亲和',
};

export function TaskDetail() {
  const { id = '' } = useParams();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getTask(id)
      .then(setTask)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) return <div className="alert">{error}</div>;
  if (!task) return <div className="empty">加载中…</div>;

  const decision = task.decision;
  const maxContribution = decision
    ? Math.max(...decision.factors.map((f) => f.contribution), 0.0001)
    : 1;

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="card-title" style={{ fontSize: 17 }}>
              {task.title}
            </h2>
            <p className="card-sub" style={{ marginBottom: 0 }}>
              任务 {task.id.slice(0, 12)} · 工作流 {task.workflow_code ?? '—'} · 优先级 P{task.priority} ·
              复杂度 {task.complexity_hint}/5
            </p>
          </div>
          <div className="row">
            <StatusBadge status={task.status} />
            {task.run_id && (
              <Link to={`/runs/${task.run_id}`}>
                <button>查看运行</button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">为什么派给它</h3>
          <p className="card-sub">
            策略 <code className="mono">{decision?.strategy ?? '—'}</code> · 规划者{' '}
            <code className="mono">{decision?.planned_by ?? '—'}</code> · 总分{' '}
            <strong>{decision?.score?.toFixed(3) ?? '—'}</strong>
          </p>

          {!decision ? (
            <div className="empty">该任务还没有调度记录</div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 14 }}>
                <span className="step-meta">执行智能体</span>
                <strong style={{ fontSize: 15 }} data-testid="decision-agent">
                  {decision.agent_code ?? '未分配'}
                </strong>
                <span className="step-meta" data-testid="decision-strategy">
                  {decision.strategy}
                </span>
              </div>

              {decision.factors.map((f) => (
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

              <p className="card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
                {decision.reason}
              </p>
              {decision.fallback_reason && (
                <p className="card-sub" style={{ color: 'var(--waiting)', marginBottom: 0 }}>
                  回退说明：{decision.fallback_reason}
                </p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <h3 className="card-title">被淘汰的候选</h3>
          <p className="card-sub">硬过滤阶段直接排除，不参与打分。</p>
          {!decision || decision.rejected.length === 0 ? (
            <div className="empty">没有候选被淘汰</div>
          ) : (
            decision.rejected.map((r) => (
              <div className="rejected-item" key={r.agent_code}>
                <strong style={{ color: 'var(--text)', minWidth: 150 }}>{r.agent_code}</strong>
                <span>{r.reason}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">任务参数</h3>
        <pre className="json">{JSON.stringify(task.payload, null, 2)}</pre>
      </div>
    </>
  );
}
