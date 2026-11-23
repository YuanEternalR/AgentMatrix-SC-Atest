import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Run } from '../api';
import { StatusBadge } from '../components/Layout';
import { TableSkeleton } from '../components/Skeleton';

export function RunsList() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');
  // 区分"还没加载完"与"加载完了确实没有数据"：否则空库会一直显示骨架屏
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = () =>
      api
        .listRuns()
        .then((rows) => {
          setRuns(rows);
          setLoaded(true);
        })
        .catch((err: Error) => setError(err.message));
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="card">
      <h2 className="card-title">运行监控</h2>
      <p className="card-sub">按创建时间倒序，实时刷新。点击查看步骤级轨迹。</p>

      {error && <div className="alert">{error}</div>}

      {!loaded && !error ? (
        <TableSkeleton rows={5} cols={5} />
      ) : runs.length === 0 ? (
        <div className="empty">还没有运行记录</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>运行</th>
              <th>状态</th>
              <th>触发</th>
              <th>成本</th>
              <th>开始时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/runs/${r.id}`)}>
                <td className="mono">{r.id.slice(0, 10)}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>{r.trigger}</td>
                <td>${Number(r.cost_usd).toFixed(5)}</td>
                <td className="step-meta">
                  {r.started_at ? new Date(r.started_at).toLocaleString('zh-CN') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
