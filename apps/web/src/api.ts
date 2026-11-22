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

export type GraphNode = {
  id: string;
  type: string;
  next?: string;
  on_true?: string;
  on_false?: string;
  skill?: string;
  agent_code?: string;
  role?: string;
  expr?: string;
  /** 手工拖动后的画布坐标；不参与版本语义对比 */
  pos?: { x: number; y: number };
};

export type WorkflowGraph = {
  entry?: string;
  nodes: GraphNode[];
  required_capabilities?: string[];
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
  graph?: WorkflowGraph | null;
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

export type FieldSchema = {
  type?: string;
  required?: boolean;
  label?: string;
  placeholder?: string;
  default?: string | number | boolean;
  description?: string;
};

export type WorkflowInfo = {
  code: string;
  name: string;
  description: string;
  stage: string;
  published_version: number | null;
  required_capabilities: string[];
  node_count: number;
  variables_schema: Record<string, FieldSchema>;
};

export type MatrixCell = {
  stage: string;
  stage_label: string;
  category: string;
  category_label: string;
  covered: boolean;
  agents: { code: string; name: string; model_tier: string; success_rate: number; capabilities: string[] }[];
};

export type MatrixData = {
  stages: { code: string; label: string }[];
  categories: { code: string; label: string }[];
  cells: MatrixCell[];
  coverage: number;
  total_cells: number;
  covered_cells: number;
  gap_count: number;
  gaps: { stage: string; stage_label: string; category: string; category_label: string }[];
  agent_count: number;
};

export type MetricsData = {
  window_hours: number;
  totals: {
    runs: number;
    finished: number;
    succeeded: number;
    failed: number;
    running: number;
    waiting_approval: number;
    success_rate: number;
    p50_ms: number;
    p95_ms: number;
    median_ms: number;
    p50_active_ms: number;
    p95_active_ms: number;
    cost_usd: number;
    avg_cost_usd: number;
    tokens: number;
  };
  trend: { hour: string; succeeded: number; failed: number; other: number }[];
  by_agent: {
    agent_code: string;
    runs: number;
    succeeded: number;
    failed: number;
    cost_usd: number;
    success_rate: number;
  }[];
  by_workflow: { workflow_code: string; runs: number; succeeded: number; failed: number }[];
  recent_failures: {
    run_id: string;
    task_id: string;
    status: string;
    error_code: string | null;
    created_at: string | null;
  }[];
};

export type WorkflowDetail = {
  code: string;
  name: string;
  description: string;
  stage: string;
  latest_version: number | null;
  graph: WorkflowGraph | null;
  versions: {
    version: number;
    status: string;
    changelog: string;
    node_count: number;
    published_at: string | null;
  }[];
};

export type GraphIssue = { code: string; message: string; node_id: string | null };
export type GraphValidation = { ok: boolean; errors: GraphIssue[]; warnings: GraphIssue[] };

export type WorkflowDiff = {
  code: string;
  from: number;
  to: number;
  from_changelog: string;
  to_changelog: string;
  summary: {
    nodes_added: number;
    nodes_removed: number;
    nodes_changed: number;
    edges_added: number;
    edges_removed: number;
    entry_changed: boolean;
  };
  nodes_added: string[];
  nodes_removed: string[];
  nodes_changed: { node_id: string; fields: { field: string; from: unknown; to: unknown }[] }[];
  edges_added: { source: string; target: string; branch: string }[];
  edges_removed: { source: string; target: string; branch: string }[];
  entry: { from: string | null; to: string | null; changed: boolean };
};

export type ArtifactInfo = {
  id: string;
  run_id: string;
  step_id: string | null;
  name: string;
  mime: string;
  uri: string;
  size: number;
  created_at: string | null;
};

export type CollaborationData = {
  nodes: { id: string; name: string; kind: 'agent' | 'skill'; calls: number }[];
  edges: { source: string; target: string; weight: number }[];
  run_count: number;
};

export type SankeyData = {
  nodes: { name: string; layer: 'source' | 'agent' | 'result' }[];
  links: { source: string; target: string; value: number }[];
};

export type BusinessData = {
  days: string[];
  otif_rate: number[];
  late_rate: number[];
  avg_delay_days: number[];
  orders: number[];
  sales: number[];
  latest: {
    otif_rate: number;
    late_rate: number;
    avg_delay_days: number;
    orders: number;
    sales: number;
  };
  total_orders: number;
  source: string;
  note?: string;
};

export type DeadLetterInfo = {
  id: string;
  run_id: string;
  task_id: string;
  node_id: string;
  error_code: string;
  message: string;
  attempts: number;
  status: string;
  created_at: string | null;
  run_status: string | null;
  task_title: string | null;
};

export type AlertRuleInfo = {
  id: string;
  name: string;
  metric: string;
  metric_label: string;
  operator: string;
  threshold: number;
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
  description: string;
  created_at: string | null;
};

export type AlertEventInfo = {
  id: string;
  rule_id: string;
  rule_name: string | null;
  status: string;
  severity: 'info' | 'warning' | 'critical';
  value: number;
  threshold: number;
  message: string;
  triggered_at: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
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

/** 列表接口把总数放在 X-Total-Count 头里，body 仍是数组 */
async function requestPaged<T>(path: string): Promise<{ items: T[]; total: number }> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { headers });
  if (res.status === 401) tokenStore.clear();
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* 非 JSON 响应 */
    }
    throw new ApiError(res.status, detail);
  }
  const items = (await res.json()) as T[];
  const total = Number(res.headers.get('X-Total-Count') ?? items.length);
  return { items, total: Number.isFinite(total) ? total : items.length };
}

export const api = {
  async login(email: string, password: string) {    const body = new URLSearchParams({ username: email, password });
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

  listTasks: (params: {
    limit?: number;
    offset?: number;
    status?: string;
    q?: string;
    order?: 'created_at' | 'risk';
  } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    if (params.status) query.set('status', params.status);
    if (params.q) query.set('q', params.q);
    if (params.order) query.set('order', params.order);
    const suffix = query.toString() ? `?${query}` : '';
    return requestPaged<Task>(`/api/v1/tasks${suffix}`);
  },
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

  listWorkflows: () => request<WorkflowInfo[]>('/api/v1/workflows'),

  getWorkflow: (code: string) => request<WorkflowDetail>(`/api/v1/workflows/${code}`),

  getWorkflowDiff: (code: string, from: number, to: number) =>
    request<WorkflowDiff>(`/api/v1/workflows/${code}/diff?from=${from}&to=${to}`),

  validateGraph: (code: string, graph: WorkflowGraph) =>
    request<GraphValidation>(`/api/v1/workflows/${code}/validate`, {
      method: 'POST',
      body: JSON.stringify({ graph }),
    }),

  saveWorkflowVersion: (code: string, graph: WorkflowGraph, changelog: string) =>
    request<{ version: number; status: string; warnings: GraphIssue[] }>(
      `/api/v1/workflows/${code}/versions`,
      { method: 'POST', body: JSON.stringify({ graph, changelog }) },
    ),

  getMatrix: () => request<MatrixData>('/api/v1/matrix'),

  getCollaboration: () => request<CollaborationData>('/api/v1/graphs/collaboration'),
  getSankey: () => request<SankeyData>('/api/v1/graphs/sankey'),
  getBusiness: (days = 30) => request<BusinessData>(`/api/v1/business?days=${days}`),

  getMetrics: (hours = 24) => request<MetricsData>(`/api/v1/metrics?hours=${hours}`),

  listArtifacts: (runId?: string) =>
    request<ArtifactInfo[]>(`/api/v1/artifacts${runId ? `?run_id=${runId}` : ''}`),

  /** 下载需要带 Bearer 头，所以走 fetch + blob，而不是裸链接 */
  async downloadArtifact(id: string): Promise<Blob> {
    const token = tokenStore.get();
    const res = await fetch(`/api/v1/artifacts/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, '下载失败');
    return res.blob();
  },

  listDeadLetters: () => request<DeadLetterInfo[]>('/api/v1/dead-letters'),
  retryDeadLetter: (id: string) =>
    request<{ id: string; status: string; run_id: string }>(`/api/v1/dead-letters/${id}/retry`, {
      method: 'POST',
    }),
  ignoreDeadLetter: (id: string) =>
    request<{ id: string; status: string }>(`/api/v1/dead-letters/${id}/ignore`, { method: 'POST' }),

  listAlertRules: () => request<AlertRuleInfo[]>('/api/v1/alert-rules'),
  patchAlertRule: (id: string, body: Record<string, unknown>) =>
    request<AlertRuleInfo>(`/api/v1/alert-rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  evaluateAlerts: () =>
    request<{ actions: { rule: string; action: string; value: number }[]; count: number }>(
      '/api/v1/alert-rules/evaluate',
      { method: 'POST' },
    ),
  listAlertEvents: () => request<AlertEventInfo[]>('/api/v1/alert-events'),
  ackAlertEvent: (id: string) =>
    request<AlertEventInfo>(`/api/v1/alert-events/${id}/ack`, { method: 'POST' }),
  resolveAlertEvent: (id: string) =>
    request<AlertEventInfo>(`/api/v1/alert-events/${id}/resolve`, { method: 'POST' }),
};
