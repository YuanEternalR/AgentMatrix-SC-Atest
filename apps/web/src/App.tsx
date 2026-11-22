import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Alerts } from './pages/Alerts';
import { DeadLetters } from './pages/DeadLetters';
import { Login } from './pages/Login';
import { MatrixView } from './pages/MatrixView';
import { RunsList } from './pages/RunsList';
import { RunDetail } from './pages/RunDetail';
import { TaskDetail } from './pages/TaskDetail';
import { Workbench } from './pages/Workbench';
import { WorkflowDesigner } from './pages/WorkflowDesigner';
import { Workflows } from './pages/Workflows';

// 监控页带着 ECharts，单独拆包，首屏不必为它付代价
const Monitor = lazy(() => import('./pages/Monitor').then((m) => ({ default: m.Monitor })));

export default function App() {
  const { user, booting, logout } = useAuth();
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

  return (
    <Layout
      strategy={strategy}
      userName={user.name}
      userRole={user.role}
      onLogout={logout}
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
        <Route
          path="/monitor"
          element={
            <Suspense fallback={<div className="empty">加载图表中…</div>}>
              <Monitor />
            </Suspense>
          }
        />
        <Route path="/runs/:id" element={<RunDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
