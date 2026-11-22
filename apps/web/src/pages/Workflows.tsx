import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type WorkflowInfo } from '../api';

export function Workflows() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<WorkflowInfo[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listWorkflows()
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="card">
      <h2 className="card-title">工作流</h2>
      <p className="card-sub">每条工作流都是不可变版本；设计器保存时会新建版本，不影响正在运行的任务。</p>

      {error && <div className="alert">{error}</div>}

      {rows.length === 0 ? (
        <div className="empty">还没有工作流</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>编码</th>
              <th>阶段</th>
              <th>版本</th>
              <th>节点</th>
              <th style={{ textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.code} style={{ cursor: 'default' }}>
                <td>
                  <strong style={{ fontSize: 13 }}>{w.name}</strong>
                  <div className="step-meta">{w.description}</div>
                </td>
                <td className="mono">{w.code}</td>
                <td>{w.stage}</td>
                <td>v{w.published_version ?? '—'}</td>
                <td>{w.node_count}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="primary" onClick={() => navigate(`/workflows/${w.code}/design`)}>
                    打开设计器
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
