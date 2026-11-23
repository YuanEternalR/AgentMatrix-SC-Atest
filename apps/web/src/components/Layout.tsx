import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { label, ROLE_LABEL, STRATEGY_SHORT } from '../labels';

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
    retrying: '重试中',
    approved: '已通过',
    rejected: '已驳回',
    expired: '已失效',
    ignored: '已忽略',
    dispatching: '分配中',
  };
  return <span className={`badge ${status}`}>{label[status] ?? status}</span>;
}

const NAV_GROUPS: { label: string; items: { to: string; text: string; end?: boolean }[] }[] = [
  {
    label: '工作',
    items: [
      { to: '/', text: '工作台', end: true },
      { to: '/matrix', text: '智能体矩阵' },
    ],
  },
  {
    label: '构建',
    items: [
      { to: '/agents', text: '智能体' },
      { to: '/skills', text: '技能库' },
      { to: '/workflows', text: '工作流' },
    ],
  },
  {
    label: '运营',
    items: [
      { to: '/runs', text: '运行监控' },
      { to: '/monitor', text: '仪表盘' },
      { to: '/analytics', text: '可视化' },
    ],
  },
  {
    label: '治理',
    items: [
      { to: '/dead-letters', text: '死信队列' },
      { to: '/alerts', text: '告警' },
      { to: '/audit', text: '审计日志' },
    ],
  },
];

export function Layout({
  children,
  strategy,
  userName,
  userRole,
  onLogout,
  title,
  subtitle,
}: {
  children: ReactNode;
  strategy: string;
  userName: string;
  userRole: string;
  onLogout: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div>
            AgentMatrix-SC
            <small>供应链智能体矩阵</small>
          </div>
        </div>

        <nav className="nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="nav-group">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  {item.text}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          调度策略
          <br />
          <span style={{ color: '#60a5fa' }}>{STRATEGY_SHORT[strategy] ?? strategy}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="page-title">{title}</div>
            <div className="page-sub">{subtitle}</div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <span className="step-meta">
              {userName}
              <span style={{ color: 'var(--border-strong)', margin: '0 6px' }}>·</span>
              {label(ROLE_LABEL, userRole)}
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
