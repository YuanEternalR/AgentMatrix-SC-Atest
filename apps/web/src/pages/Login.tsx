import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('ops@agentmatrix.local');
  const [password, setPassword] = useState('AgentMatrix@2026');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请检查后端是否已启动');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>AgentMatrix-SC</h1>
        <p>面向供应链的智能体矩阵工作台</p>

        <div className="field">
          <label className="field">邮箱</label>
          <input
            data-testid="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="field">
          <label className="field">密码</label>
          <input
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <div className="alert">{error}</div>}

        <button className="primary" data-testid="login-submit" type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>

        <p style={{ marginTop: 14, marginBottom: 0 }}>
          演示账号：admin / dev / ops / viewer @agentmatrix.local，密码 AgentMatrix@2026
        </p>
      </form>
    </div>
  );
}
