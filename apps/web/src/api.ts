/** 极简 API 客户端：只做鉴权、JSON 编解码与错误归一化。 */

export type User = { id: string; email: string; name: string; role: string };

export type Factor = {
  name: string;
  raw: number;
  weight: number;
  contribution: number;
  detail: string;
};

export type Rejection = { agent_code: string; reason: string };

export type Decision = {
  strategy: string;
  agent_code: string | null;
  score: number;
  factors: Factor[];
  rejected: Rejection[];
  planned_by: string;
  fallback_reason: string | null;
  reason: string;
};

export type Task = {
  id: string;
  title: string;
  status: string;
  priority: number;
  complexity_hint: number;
  payload: Record<string, unknown>;
  required_capabilities: string[];
  created_at: string;
  run_id?: string | null;
  run_status?: string | null;
  decision?: Decision | null;
  workflow_code?: string | null;
};

export type RunStep = {
  id: string;
  node_id: string;
  node_type: string;
  status: string;
  attempt: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  tokens: number;
  cost_usd: number;
};

export type Run = {
  id: string;
  task_id: string;
  status: string;
  trigger: string;
  trace_id: string;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number;
  token_input: number;
  token_output: number;
  error_code: string | null;
  steps?: RunStep[];
  workflow_version?: number | null;
};

export type Approval = {
  id: string;
  run_id: string;
  step_id: string | null;
  status: string;
  assignee_role: string;
  decision: string | null;
  comment: string;
  created_at: string;
  decided_at: string | null;
};

export type AgentInfo = {
  code: string;
  name: string;
  stage: string;
  capabilities: string[];
  status: string;
  model_tier: string;
  success_rate: number;
  avg_cost_usd: number;
  p95_latency_ms: number;
  max_concurrency: number;
  published_version: number | null;
};

const TOKEN_KEY = 'am_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    tokenStore.clear();
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* 响应不是 JSON，保留状态码文案 */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  async login(email: string, password: string) {
    const body = new URLSearchParams({ username: email, password });
    return request<{ access_token: string; user: User }>('/api/v1/auth/login', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },

  me: () => request<User>('/api/v1/auth/me'),

  meta: () =>
    request<{ name: string; version: string; env: string; dispatch: { active_strategy: string; strategies: { name: string; label: string }[] } }>(
      '/api/v1/meta',
    ),

  listTasks: () => request<Task[]>('/api/v1/tasks'),
  getTask: (id: string) => request<Task>(`/api/v1/tasks/${id}`),
  createTask: (payload: Record<string, unknown>) =>
    request<Task>('/api/v1/tasks', { method: 'POST', body: JSON.stringify(payload) }),

  listRuns: () => request<Run[]>('/api/v1/runs'),
  getRun: (id: string) => request<Run>(`/api/v1/runs/${id}`),

  listApprovals: () => request<Approval[]>('/api/v1/approvals'),
  decide: (id: string, decision: 'approved' | 'rejected', comment = '') =>
    request<Approval>(`/api/v1/approvals/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    }),

  listAgents: () => request<AgentInfo[]>('/api/v1/agents'),
};
