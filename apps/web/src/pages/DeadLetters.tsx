import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DeadLetterInfo } from '../api';

const CODE_LABEL: Record<string, string> = {
  TRANSIENT: '瞬时故障（可重试）',
  TIMEOUT: '超时（可重试）',
  RATE_LIMIT: '上游限流（可重试）',
  UPSTREAM: '上游错误（可重试）',
  VALIDATION: '参数校验失败（不可重试）',
  PERMISSION: '权限不足（不可重试）',
  BUSINESS: '业务规则拒绝（不可重试）',
  UNKNOWN: '未知错误（默认不重试）',
};

export function DeadLetters() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DeadLetterInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listDeadLetters();
      // Invoke 风格的接口在空列表时可能返回 null，这里兜底成空数组
      setRows(Array.isArray(res) ? res : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(id: string, action: 'retry' | 'ignore') {
    setBusy(true);
    try {
      if (action === 'retry') await api.retryDeadLetter(id);
      else await api.ignoreDeadLetter(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card-title">死信队列</h2>
      <p className="card-sub">
        重试耗尽后进入这里。人工重试会把运行放回失败节点继续执行，忽略则仅归档。
      </p>

      {error && <div className="alert">{error}</div>}

      {rows.length === 0 ? (
        <div className="empty">没有待处理死信</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>任务</th>
              <th>失败节点</th>
              <th>错误分类</th>
              <th>尝试次数</th>
              <th>时间</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ cursor: 'default' }}>
                <td>{row.task_title ?? row.task_id.slice(0, 8)}</td>
                <td className="mono">{row.node_id}</td>
                <td>
                  <span className="badge failed">{row.error_code}</span>
                  <div className="step-meta" style={{ marginTop: 2 }}>
                    {CODE_LABEL[row.error_code] ?? row.error_code}
                  </div>
                </td>
                <td>{row.attempts}</td>
                <td className="step-meta">
                  {row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '—'}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => navigate(`/runs/${row.run_id}`)} style={{ marginRight: 6 }}>
                    查看
                  </button>
                  <button className="primary" disabled={busy} onClick={() => void act(row.id, 'retry')}>
                    重试
                  </button>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => void act(row.id, 'ignore')}
                    style={{ marginLeft: 6 }}
                  >
                    忽略
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
