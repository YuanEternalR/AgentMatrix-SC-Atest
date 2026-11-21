import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = {
    succeeded: '成功',
    running: '运行中',
    queued: '排队中',
    waiting_approval: '待审批',
    pending: '待处理',
    failed: '失败',
    canceled: '已取消',
    skipped: '跳过',
    approved: '已通过',
    rejected: '已驳回',
  };
  return <span className={`badge ${status}`}>{label[status] ?? status}</span>;
}

export function Layout({
  children,
  strategy,
  userName,
  userRole,
  onLogout,
}: {
  children: ReactNode;
  strategy: string;
  userName: string;
  userRole: string;
  onLogout: () => void;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          AgentMatrix-SC<small>供应链智能体矩阵</small>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            工作台
          </NavLink>
          <NavLink to="/matrix" className={({ isActive }) => (isActive ? 'active' : '')}>
            智能体矩阵
          </NavLink>
          <NavLink to="/runs" className={({ isActive }) => (isActive ? 'active' : '')}>
            运行监控
          </NavLink>
          <NavLink to="/monitor" className={({ isActive }) => (isActive ? 'active' : '')}>
            仪表盘
          </NavLink>
          <NavLink to="/dead-letters" className={({ isActive }) => (isActive ? 'active' : '')}>
            死信队列
          </NavLink>
          <NavLink to="/alerts" className={({ isActive }) => (isActive ? 'active' : '')}>
            告警
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          调度策略
          <br />
          <span style={{ color: '#93c5fd' }}>{strategy}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="card-sub" style={{ margin: 0 }}>
            大模型规划 / 小模型与 skill 执行的矩阵调度
          </span>
          <div className="row" style={{ gap: 10 }}>
            <span className="card-sub" style={{ margin: 0 }}>
              {userName} · {userRole}
            </span>
            <button className="ghost" onClick={onLogout}>
              退出
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
