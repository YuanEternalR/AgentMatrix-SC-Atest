/**
 * AgentMatrix-SC × DSH 连接器
 *
 * 把工作台的能力暴露为 DSH 工具，让 DSH 里的智能体可以直接：
 *   发起任务 → 查看调度依据 → 查运行状态 → 看矩阵覆盖
 *
 * ⚠️ 关于参数 schema（踩过的坑，改动前务必读 docs/dsh-integration.md）：
 *   1. `parameters` 必须写成**标准 JSON Schema**（type/properties/required 齐全），
 *      宿主会把它原样作为 function 的 parameters 交给模型 API；
 *   2. 属性名不得与 JSON Schema 关键字同名（title/description/type/required/
 *      properties/additionalProperties/items/...），否则宿主会把属性当成关键字，
 *      模型 API 直接拒绝整个 schema；
 *   3. object 类型必须显式写 additionalProperties。
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

const textRender = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

export async function apply(ctx) {
  const defineTool = await loadDefineTool()

  ctx.tools.register(
    defineTool({
      name: 'agentmatrix_create_task',
      description:
        '在 AgentMatrix 工作台发起一个任务，返回调度决策（派给了哪个智能体、打分依据）。' +
        '用于把业务请求交给矩阵执行。',
      parameters: {
        type: 'object',
        properties: {
          task_title: { type: 'string', description: '任务标题，例如：订单 SO-001 延迟异常' },
          workflow_code: {
            type: 'string',
            description: '工作流编码：order_delay_exception 或 literature_review',
          },
          payload: {
            type: 'object',
            additionalProperties: true,
            description: '业务参数对象，例如 {"order_id":"SO-001","quantity":120}；文献综述为 {"topic":"..."}',
          },
          priority: { type: 'integer', description: '优先级 1（最高）到 5，默认 3' },
          complexity_hint: { type: 'integer', description: '任务复杂度 1–5，默认 3' },
          wait_seconds: {
            type: 'integer',
            description:
              '创建后等待多少秒让工作台执行，默认 8、最大 40。等待期间会返回真实运行状态；' +
              '填 0 表示只建任务不等待。',
          },
        },
        required: ['task_title', 'workflow_code'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: textRender },
      async execute(args) {
        if (!args?.task_title) throw new Error('缺少必填参数 task_title：请提供任务标题')
        if (!args?.workflow_code) {
          throw new Error('缺少必填参数 workflow_code：order_delay_exception 或 literature_review')
        }

        const body = {
          title: args.task_title,
          workflow_code: args.workflow_code,
          payload: args.payload ?? {},
          priority: args.priority ?? 3,
          complexity_hint: args.complexity_hint ?? 3,
        }
        const task = await call('/tasks', { method: 'POST', body: JSON.stringify(body) })

        const summary = {
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

        // 等一会儿看真实执行结果：不等待的话"任务跑起来了"在对话里是看不见的
        const wait = Math.min(Math.max(Number(args.wait_seconds ?? 8), 0), 40)
        if (wait <= 0 || !task.run_id) return summary

        const terminal = new Set(['succeeded', 'failed', 'waiting_approval', 'canceled'])
        const deadline = Date.now() + wait * 1000
        let run = null
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          run = await call(`/runs/${task.run_id}`)
          if (terminal.has(run.status)) break
        }

        if (!run) return summary
        const result = {
          ...summary,
          run: {
            status: run.status,
            steps: (run.steps ?? []).length,
            cost_usd: run.cost_usd,
            waited_seconds: wait,
          },
        }
        if (run.status === 'waiting_approval') {
          const approvals = await call('/approvals')
          const mine = (Array.isArray(approvals) ? approvals : []).find(
            (a) => a.run_id === run.id && a.status === 'pending',
          )
          result.pending_approval_id = mine?.id ?? null
          result.next_step = '运行停在人工审批节点，需在工作台「待我审批」里通过后才会继续'
        }
        return result
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'agentmatrix_explain_dispatch',
      description:
        '解释某个任务的调度依据：为什么派给这个智能体、每个因子贡献多少、哪些候选被淘汰。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '任务 ID（32 位十六进制）' },
        },
        required: ['task_id'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: textRender },
      async execute(args) {
        if (!args?.task_id) throw new Error('缺少必填参数 task_id')
        const task = await call(`/tasks/${args.task_id}`)
        const decision = task.decision
        if (!decision) {
          return { task_id: args.task_id, decision: null, note: '该任务还没有调度记录' }
        }
        return {
          task_id: task.id,
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
        type: 'object',
        properties: {
          run_id: { type: 'string', description: '运行 ID' },
        },
        required: ['run_id'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: textRender },
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
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: textRender },
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
