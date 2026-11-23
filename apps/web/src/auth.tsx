import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore, type User } from './api';

type AuthContextValue = {
  user: User | null;
  booting: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    // 工作台外壳（Electron / 浏览器模式）通过 ?token= 注入登录态。
    // 为什么用 URL 传：外壳与面板不是同一个源，读不到对方的 localStorage；
    // 而所有面板都来自同一个 5173，所以第一个面板写入后，其余面板直接复用。
    // 写入后立刻把 token 从地址栏抹掉，避免留在历史记录里。
    const params = new URLSearchParams(window.location.search);
    const injected = params.get('token');
    if (injected) {
      tokenStore.set(injected);
      params.delete('token');
      const query = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
    }

    if (!tokenStore.get()) {
      setBooting(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setBooting(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      booting,
      async login(email, password) {
        const result = await api.login(email, password);
        tokenStore.set(result.access_token);
        setUser(result.user);
      },
      logout() {
        tokenStore.clear();
        setUser(null);
      },
    }),
    [user, booting],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
