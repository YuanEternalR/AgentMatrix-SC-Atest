import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { RunsList } from './pages/RunsList';
import { RunDetail } from './pages/RunDetail';
import { TaskDetail } from './pages/TaskDetail';
import { Workbench } from './pages/Workbench';

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
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/runs" element={<RunsList />} />
        <Route path="/runs/:id" element={<RunDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
