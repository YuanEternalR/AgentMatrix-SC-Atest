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
  agent_name?: string | null;
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
  workflow_name?: string | null;
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
  description?: string;
  stage: string;
  capabilities: string[];
  status: string;
  model_tier: string;
  tier_label?: string;
  success_rate: number;
  avg_cost_usd: number;
  p95_latency_ms: number;
  max_concurrency: number;
  published_version: number | null;
  skill_count?: number;
};

export type SkillRunInfo = {
  id: string;
  ok: boolean;
  duration_ms: number;
  source: string;
  input: Record<string, unknown>;
  error: string;
  error_code: string;
  created_at: string | null;
};

export type SkillInfo = {
  code: string;
  name: string;
  category: string;
  category_label: string;
  type: string;
  type_label: string;
  description: string;
  input_schema: Record<string, FieldSchema>;
  output_schema: Record<string, unknown>;
  timeout_sec: number;
  rate_limit: number | null;
  status: string;
  version: number;
  secret_ref: string | null;
  reference_count: number;
  runs: number;
  success_rate: number | null;
  avg_ms: number | null;
  created_at: string | null;
  config?: Record<string, unknown>;
  mock?: boolean | null;
  references?: { kind: string; code: string; name: string; versions: number[] }[];
  recent_runs?: SkillRunInfo[];
};

export type SkillTestResult = {
  ok: boolean;
  output: Record<string, unknown>;
  error: string;
  error_code: string;
  duration_ms: number;
  mode: string;
  started_at: string;
};

export type SkillVersionContent = {
  system_prompt: string;
  skill_ids: string[];
  model_config: Record<string, unknown>;
  io_schema: Record<string, unknown>;
  guardrails: Record<string, unknown>;
  changelog: string;
  publish?: boolean;
};

export type AgentVersionInfo = SkillVersionContent & {
  id: string;
  version: number;
  status: string;
  published_at: string | null;
  prompt_length?: number;
};

export type AgentDetail = {
  code: string;
  name: string;
  description: string;
  stage: string;
  capabilities: string[];
  status: string;
  model_tier: string;
  tier_label: string;
  success_rate: number;
  avg_cost_usd: number;
  p95_latency_ms: number;
  max_concurrency: number;
  published: AgentVersionInfo | null;
  draft: AgentVersionInfo | null;
  skills: { code: string; name: string; type: string; exists: boolean }[];
  versions: AgentVersionInfo[];
  recent_steps: {
    step_id: string;
    run_id: string;
    node_id: string;
    status: string;
    tokens: number;
    cost_usd: number;
    started_at: string | null;
  }[];
};

export type TraceStep = {
  kind: 'tool' | 'llm';
  name: string;
  label: string;
  ok: boolean;
  duration_ms: number;
  tokens: number;
  error?: string;
  error_code?: string;
  output?: Record<string, unknown>;
  cost_usd?: number;
  token_input?: number;
  token_output?: number;
};

export type AgentTestResult = {
  ok: boolean;
  version: number;
  version_status: string;
  trace: TraceStep[];
  output: string;
  provider?: string;
  model?: string;
  tokens: number;
  cost_usd: number;
  duration_ms: number;
  note?: string;
  error?: string;
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
  stages: {
    code: string;
    label: string;
    industry?: {
      influence: number;
      sensitivity: number;
      output_share: number;
      sectors: number;
    } | null;
  }[];
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
    agent_name?: string | null;
    runs: number;
    succeeded: number;
    failed: number;
    cost_usd: number;
    success_rate: number;
  }[];
  by_workflow: {
    workflow_code: string;
    workflow_name?: string | null;
    runs: number;
    succeeded: number;
    failed: number;
  }[];
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
  threshold_label: string;
  /** 当前指标值（24 小时窗口），页面据此显示"当前多少、是否成立" */
  current_value: number | null;
  current_label: string | null;
  firing: boolean | null;
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

export type AuditLogInfo = {
  id: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  actor_role_label: string;
  action: string;
  action_label: string;
  resource_type: string;
  resource_type_label: string;
  resource_id: string;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string;
  user_agent: string;
  created_at: string | null;
};

export type AuditSummary = {
  days: number;
  total: number;
  today: number;
  actors: number;
  by_action: { action: string; label: string; count: number }[];
  actions: { action: string; label: string }[];
  resources: { resource_type: string; label: string }[];
};

export type AuditQuery = {
  action?: string;
  resource_type?: string;
  q?: string;
  days?: number;
  limit?: number;
  offset?: number;
};

export type DispatchConfig = {
  strategy: string;
  weights: Record<string, number>;
  sla_headroom: number;
  min_success_rate: number;
};

export type DispatchSettings = {
  config: DispatchConfig;
  source: 'env' | 'db';
  defaults: DispatchConfig;
  strategies: {
    name: string;
    label: string;
    description: string;
    research_role: string;
  }[];
  factors: { code: string; label: string; description: string }[];
};

export type DispatchPreview = {
  strategy: string;
  weights: Record<string, number>;
  chosen: string;
  score: number;
  reason: string;
  planned_by: string;
  factors: Factor[];
  rejected: Rejection[];
  eligible_count: number;
  candidates: {
    code: string;
    name: string;
    stage: string;
    capabilities: string[];
    success_rate: number;
    avg_cost_usd: number;
    p95_latency_ms: number;
    inflight: number;
  }[];
};

export type SearchItem = {
  id: string;
  title: string;
  subtitle: string;
  route: string;
};

export type SearchResult = {
  query: string;
  total: number;
  groups: { kind: string; label: string; items: SearchItem[] }[];
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

  search: (q: string) =>
    request<SearchResult>(`/api/v1/search?q=${encodeURIComponent(q)}`),

  meta: () =>
    request<{ name: string; version: string; env: string; dispatch: { active_strategy: string; strategies: { name: string; label: string }[] } }>(
      '/api/v1/meta',
    ),

  /** 工作台助手：场景 + 问题 → 模型结论（后端会把实时快照一起喂给它） */
  askWorkbench: (body: {
    scenario: string;
    scenario_name?: string;
    memory?: string;
    question: string;
    use_mock?: boolean;
  }) =>
    request<{
      ok: boolean;
      answer: string;
      provider?: string;
      model?: string;
      tokens?: number;
      cost_usd?: number;
      duration_ms?: number;
      error?: string;
      snapshot?: {
        tasks: Record<string, number>;
        runs_24h: Record<string, number>;
        pending_approvals: number;
        pending_dead_letters: number;
        matrix: { coverage: number; covered_cells: number; total_cells: number; gap_count: number };
        dispatch: { strategy: string };
      };
    }>('/api/v1/workbench/ask', { method: 'POST', body: JSON.stringify(body) }),

  workbenchContext: () =>
    request<{
      tasks: Record<string, number>;
      runs_24h: Record<string, number>;
      pending_approvals: number;
      pending_dead_letters: number;
      matrix: { coverage: number; covered_cells: number; total_cells: number; gap_count: number };
      dispatch: { strategy: string; source: string };
    }>('/api/v1/workbench/context'),

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

  getAgent: (code: string) => request<AgentDetail>(`/api/v1/agents/${code}`),
  createAgent: (body: Record<string, unknown>) =>
    request<AgentDetail>('/api/v1/agents', { method: 'POST', body: JSON.stringify(body) }),
  patchAgent: (code: string, body: Record<string, unknown>) =>
    request<AgentDetail>(`/api/v1/agents/${code}`, { method: 'PATCH', body: JSON.stringify(body) }),
  publishAgentVersion: (code: string, body: SkillVersionContent) =>
    request<AgentDetail>(`/api/v1/agents/${code}/versions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  testAgent: (code: string, input: Record<string, unknown>, useMock: boolean) =>
    request<AgentTestResult>(`/api/v1/agents/${code}/test`, {
      method: 'POST',
      body: JSON.stringify({ input, use_mock: useMock }),
    }),

  listSkills: (params: { q?: string; type?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.type) query.set('type', params.type);
    const suffix = query.toString() ? `?${query}` : '';
    return requestPaged<SkillInfo>(`/api/v1/skills${suffix}`);
  },
  getSkill: (code: string) => request<SkillInfo>(`/api/v1/skills/${code}`),
  createSkill: (body: Record<string, unknown>) =>
    request<SkillInfo>('/api/v1/skills', { method: 'POST', body: JSON.stringify(body) }),
  createSkillVersion: (code: string, body: Record<string, unknown>) =>
    request<SkillInfo>(`/api/v1/skills/${code}/versions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  testSkill: (code: string, inputs: Record<string, unknown>, forceMock?: boolean) =>
    request<SkillTestResult>(`/api/v1/skills/${code}/test`, {
      method: 'POST',
      body: JSON.stringify({ inputs, force_mock: forceMock ?? null }),
    }),
  deleteSkill: (code: string) =>
    request<void>(`/api/v1/skills/${code}`, { method: 'DELETE' }),
  builtinRegistry: () =>
    request<{ function: string; doc: string }[]>('/api/v1/skills/registry'),

  getDispatchSettings: () => request<DispatchSettings>('/api/v1/settings/dispatch'),
  saveDispatchSettings: (body: DispatchConfig) =>
    request<DispatchSettings>('/api/v1/settings/dispatch', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  previewDispatch: (body: {
    required_capabilities: string[];
    priority: number;
    complexity_hint: number;
    weights?: Record<string, number>;
    strategy?: string;
  }) =>
    request<DispatchPreview>('/api/v1/settings/dispatch/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

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

  getAuditSummary: (days = 7) => request<AuditSummary>(`/api/v1/audit-logs/summary?days=${days}`),

  listAuditLogs: (params: AuditQuery = {}) => {
    const query = new URLSearchParams();
    if (params.action) query.set('action', params.action);
    if (params.resource_type) query.set('resource_type', params.resource_type);
    if (params.q) query.set('q', params.q);
    if (params.days) query.set('days', String(params.days));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query}` : '';
    return requestPaged<AuditLogInfo>(`/api/v1/audit-logs${suffix}`);
  },

  /** 导出走 fetch + blob（下载需要 Bearer 头，裸链接带不了） */
  async downloadAuditCsv(params: AuditQuery = {}): Promise<Blob> {
    const query = new URLSearchParams();
    if (params.action) query.set('action', params.action);
    if (params.resource_type) query.set('resource_type', params.resource_type);
    if (params.q) query.set('q', params.q);
    if (params.days) query.set('days', String(params.days));

    const token = tokenStore.get();
    const res = await fetch(`/api/v1/audit-logs/export.csv?${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, '导出审计日志失败');
    return res.blob();
  },
};
