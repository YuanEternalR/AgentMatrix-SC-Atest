import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Alerts } from './pages/Alerts';
import { AuditLog } from './pages/Audit';
import { DeadLetters } from './pages/DeadLetters';
import { Login } from './pages/Login';
import { MatrixView } from './pages/MatrixView';
import { RunsList } from './pages/RunsList';
import { RunDetail } from './pages/RunDetail';
import { TaskDetail } from './pages/TaskDetail';
import { Workbench } from './pages/Workbench';
import { WorkflowDesigner } from './pages/WorkflowDesigner';
import { Workflows } from './pages/Workflows';

// 监控与可视化页带着 ECharts，单独拆包，首屏不必为它付代价
const Monitor = lazy(() => import('./pages/Monitor').then((m) => ({ default: m.Monitor })));
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));

/** 路由 → 顶栏标题。集中一处，避免每个页面各自写死 */
const PAGE_META: { match: (path: string) => boolean; title: string; subtitle: string }[] = [
  { match: (p) => p === '/', title: '工作台', subtitle: '发起任务、处理待办、跟进异常' },
  { match: (p) => p.startsWith('/matrix'), title: '智能体矩阵', subtitle: '阶段 × 能力的覆盖情况与缺口' },
  { match: (p) => p.includes('/design'), title: '工作流设计器', subtitle: '编排、校验、版本管理' },
  { match: (p) => p.startsWith('/workflows'), title: '工作流', subtitle: '不可变版本与发布状态' },
  { match: (p) => p.startsWith('/tasks/'), title: '任务详情', subtitle: '调度依据与执行结果' },
  { match: (p) => p.startsWith('/runs/'), title: '运行详情', subtitle: '步骤轨迹、审批与产物' },
  { match: (p) => p === '/runs', title: '运行监控', subtitle: '所有运行的状态与成本' },
  { match: (p) => p === '/monitor', title: '仪表盘', subtitle: '吞吐、成功率、耗时与成本' },
  { match: (p) => p === '/analytics', title: '可视化', subtitle: '拓扑、流转与业务看板' },
  { match: (p) => p === '/dead-letters', title: '死信队列', subtitle: '重试耗尽的运行，需要人工处理' },
  { match: (p) => p === '/alerts', title: '告警', subtitle: '规则与未关闭事件' },
  { match: (p) => p === '/audit', title: '审计日志', subtitle: '谁在什么时候改了什么，只追加不可删除' },
];

function metaFor(path: string) {
  return (
    PAGE_META.find((m) => m.match(path)) ?? { title: 'AgentMatrix-SC', subtitle: '智能体矩阵工作台' }
  );
}

export default function App() {
  const { user, booting, logout } = useAuth();
  const location = useLocation();
  const [strategy, setStrategy] = useState('—');

  useEffect(() => {
    if (!user) return;
    api
      .meta()
      .then((m) => setStrategy(m.dispatch.active_strategy))
      .catch(() => setStrategy('不可用'));
  }, [user]);

  if (booting) return <div className="empty">加载中…</div>;
  if (!user) return <Login />;

  const meta = metaFor(location.pathname);

  return (
    <Layout
      strategy={strategy}
      userName={user.name}
      userRole={user.role}
      onLogout={logout}
      title={meta.title}
      subtitle={meta.subtitle}
    >
      <Routes>
        <Route path="/" element={<Workbench />} />
        <Route path="/matrix" element={<MatrixView />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/:code/design" element={<WorkflowDesigner />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/runs" element={<RunsList />} />
        <Route path="/dead-letters" element={<DeadLetters />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route
          path="/monitor"
          element={
            <Suspense fallback={<div className="empty">加载图表中…</div>}>
              <Monitor />
            </Suspense>
          }
        />
        <Route path="/runs/:id" element={<RunDetail />} />
        <Route
          path="/analytics"
          element={
            <Suspense fallback={<div className="empty">加载图表中…</div>}>
              <Analytics />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
