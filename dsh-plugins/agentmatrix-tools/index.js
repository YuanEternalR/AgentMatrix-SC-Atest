/**
 * AgentMatrix-SC × DSH 连接器
 *
 * 把工作台的能力暴露为 DSH 工具，让 DSH 里的智能体可以直接：
 *   发起任务 → 查看调度依据 → 查运行状态 → 看矩阵覆盖
 *
 * 依赖注入：`inject: ['tools']` 让 Cordis 等工具注册表就绪后再调用 apply。
 * 所有注册都是可逆副作用，插件卸载时自动注销。
 */

export const name = 'agentmatrix-tools'
export const inject = ['tools']

const API = process.env.AGENTMATRIX_API ?? 'http://127.0.0.1:8000/api/v1'
const EMAIL = process.env.AGENTMATRIX_EMAIL ?? 'ops@agentmatrix.local'
const PASSWORD = process.env.AGENTMATRIX_PASSWORD ?? 'AgentMatrix@2026'

let token = null

async function ensureToken() {
  if (token) return token
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`AgentMatrix 登录失败：${res.status}`)
  const data = await res.json()
  token = data.access_token
  return token
}

async function call(pathname, init = {}, retried = false) {
  const auth = await ensureToken()
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${auth}`,
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 401 && !retried) {
    token = null
    return call(pathname, init, true)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`AgentMatrix ${pathname} → ${res.status} ${text.slice(0, 200)}`)
  }
  return res.json()
}

/** 让工具在缺少 defineTool 时也能工作：两者都只是"声明 + 执行函数"的对象 */
async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    return mod.defineTool ?? ((spec) => spec)
  } catch {
    return (spec) => spec
  }
}

export async function apply(ctx) {
  const defineTool = await loadDefineTool()

  ctx.tools.register(
    defineTool({
      name: 'agentmatrix_create_task',
      description:
        '在 AgentMatrix 工作台发起一个任务，返回调度决策（派给了哪个智能体、打分依据）。' +
        '用于把业务请求交给矩阵执行。',
      parameters: {
        title: { type: 'string', description: '任务标题，例如「订单 SO-001 延迟异常」' },
        workflow_code: {
          type: 'string',
          
          description: '工作流编码：order_delay_exception 或 literature_review',
        },
        payload: {
          type: 'object',
          // DSH 的 schema DSL 要求 object 类型显式声明 additionalProperties
          additionalProperties: true,
          description: '业务参数，如 {"order_id":"SO-001","quantity":120}；文献综述为 {"topic":"..."}',
        },
        priority: { type: 'integer', description: '1（最高）到 5，默认 3' },
        complexity_hint: { type: 'integer', description: '任务复杂度 1–5，默认 3' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        // schema 里不能写 required（会被原样发给模型 API），所以必填在这里校验。
        // 抛错会作为工具结果回给模型，模型据此补齐参数。
        if (!args?.title) throw new Error('缺少必填参数 title：请提供任务标题')
        if (!args?.workflow_code) {
          throw new Error('缺少必填参数 workflow_code：order_delay_exception 或 literature_review')
        }

        const body = {
          title: args.title,
          workflow_code: args.workflow_code,
          payload: args.payload ?? {},
          priority: args.priority ?? 3,
          complexity_hint: args.complexity_hint ?? 3,
        }
        const task = await call('/tasks', { method: 'POST', body: JSON.stringify(body) })
        return {
          task_id: task.id,
          status: task.status,
          run_id: task.run_id ?? null,
          assigned_to: task.decision?.agent_code ?? null,
          strategy: task.decision?.strategy ?? null,
          score: task.decision?.score ?? null,
          reason: task.decision?.reason ?? null,
          top_factors: (task.decision?.factors ?? []).slice(0, 3).map((f) => ({
            factor: f.name,
            contribution: f.contribution,
            detail: f.detail,
          })),
          rejected: (task.decision?.rejected ?? []).slice(0, 5).map((r) => ({
            agent: r.agent_code,
            reason: r.reason,
          })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'agentmatrix_explain_dispatch',
      description:
        '解释某个任务的调度依据：为什么派给这个智能体、每个因子贡献多少、哪些候选被淘汰。',
      parameters: {
        task_id: { type: 'string', description: '任务 ID（32 位十六进制）' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        if (!args?.task_id) throw new Error('缺少必填参数 task_id')
        const task = await call(`/tasks/${args.task_id}`)
        const decision = task.decision
        if (!decision) return { task_id: args.task_id, decision: null, note: '该任务还没有调度记录' }
        return {
          task_id: task.id,
          title: task.title,
          status: task.status,
          strategy: decision.strategy,
          planned_by: decision.planned_by,
          assigned_to: decision.agent_code,
          score: decision.score,
          reason: decision.reason,
          factors: decision.factors.map((f) => ({
            factor: f.name,
            raw: f.raw,
            weight: f.weight,
            contribution: f.contribution,
            detail: f.detail,
          })),
          rejected: decision.rejected,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'agentmatrix_run_status',
      description: '查询某个运行的状态与步骤轨迹（每个节点的状态、耗时、成本）。',
      parameters: {
        run_id: { type: 'string', description: '运行 ID' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        if (!args?.run_id) throw new Error('缺少必填参数 run_id')
        const run = await call(`/runs/${args.run_id}`)
        return {
          run_id: run.id,
          status: run.status,
          cost_usd: run.cost_usd,
          tokens: (run.token_input ?? 0) + (run.token_output ?? 0),
          error_code: run.error_code,
          steps: (run.steps ?? []).map((s) => ({
            node: s.node_id,
            type: s.node_type,
            status: s.status,
            attempt: s.attempt,
          })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'agentmatrix_matrix_coverage',
      description: '查看智能体矩阵的覆盖率与能力缺口（哪些阶段×能力还没有智能体）。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute() {
        const matrix = await call('/matrix')
        return {
          coverage: matrix.coverage,
          covered_cells: matrix.covered_cells,
          total_cells: matrix.total_cells,
          agent_count: matrix.agent_count,
          gaps: matrix.gaps.map((g) => `${g.stage_label} × ${g.category_label}`),
        }
      },
    }),
  )
}
