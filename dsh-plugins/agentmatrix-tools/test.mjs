/**
 * 离线测试：用假的 ctx.tools 捕获工具定义，逐个验证声明与 execute。
 *
 * 不需要 DSH 在跑，也不需要真实模型——只验证"插件把什么交给宿主"以及
 * "工具执行时的行为是否符合预期"。
 *
 * 用法：node dsh-plugins/agentmatrix-tools/test.mjs
 *   默认走真实后端（http://127.0.0.1:8000）；不可用时自动跳过执行类断言。
 */

import { apply, name, inject } from './index.js'

const registered = []
const fakeCtx = {
  tools: {
    register(tool) {
      registered.push(tool)
      return () => {}
    },
  },
}

let failures = 0
function check(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`)
  } else {
    failures += 1
    console.log(`  ❌ ${message}`)
  }
}

console.log('1) 插件元数据')
check(name === 'agentmatrix-tools', `name = ${name}`)
check(Array.isArray(inject) && inject.includes('tools'), `inject 声明了 tools：${JSON.stringify(inject)}`)

console.log('\n2) 注册工具')
await apply(fakeCtx)
const names = registered.map((t) => t.name)
check(registered.length === 4, `注册了 4 个工具（实际 ${registered.length}）`)
for (const expected of [
  'agentmatrix_create_task',
  'agentmatrix_explain_dispatch',
  'agentmatrix_run_status',
  'agentmatrix_matrix_coverage',
]) {
  check(names.includes(expected), `包含 ${expected}`)
}

console.log('\n3) 工具声明完整性')
for (const tool of registered) {
  const ok =
    typeof tool.name === 'string' &&
    typeof tool.description === 'string' &&
    tool.description.length > 10 &&
    typeof tool.parameters === 'object' &&
    typeof tool.execute === 'function' &&
    tool.output &&
    typeof tool.output.render === 'function'
  check(ok, `${tool.name} 具备 name/description/parameters/execute/output.render`)
}

console.log('\n4) 参数 schema 可序列化为 JSON Schema 形状')
for (const tool of registered) {
  const params = tool.parameters
  const valid =
    typeof params === 'object' &&
    Object.values(params).every(
      (v) => typeof v === 'object' && ['string', 'integer', 'number', 'boolean', 'object', 'array'].includes(v.type),
    )
  check(valid, `${tool.name} 参数类型合法`)
}

console.log('\n5) 属性级不得出现 required（DSH 会原样发给模型 API，required 只能是父级字符串数组）')
for (const tool of registered) {
  const offenders = Object.entries(tool.parameters ?? {})
    .filter(([, spec]) => spec && Object.prototype.hasOwnProperty.call(spec, 'required'))
    .map(([key]) => key)
  check(
    offenders.length === 0,
    offenders.length === 0
      ? `${tool.name} 属性中没有 required 字段`
      : `${tool.name} 以下属性带了 required：${offenders.join(', ')}`,
  )
}

console.log('\n5.1) 必填约束在 execute 里兜底（缺参数应抛错而不是静默）')
const createTool = registered.find((t) => t.name === 'agentmatrix_create_task')
let threw = false
try {
  await createTool.execute({})
} catch {
  threw = true
}
check(threw, 'create_task 缺 title/workflow_code 时会抛错')

console.log('\n6) object 类型参数必须显式声明 additionalProperties')
for (const tool of registered) {
  const offenders = Object.entries(tool.parameters ?? {})
    .filter(([, spec]) => spec && spec.type === 'object' && typeof spec.additionalProperties !== 'boolean')
    .map(([key]) => key)
  check(
    offenders.length === 0,
    offenders.length === 0
      ? `${tool.name} object 参数声明合规`
      : `${tool.name} 以下 object 参数缺少 additionalProperties：${offenders.join(', ')}`,
  )
}

console.log('\n7) output.schema 的 object 同样需要 additionalProperties')
for (const tool of registered) {
  const schema = tool.output?.schema
  const ok = !schema || schema.type !== 'object' || typeof schema.additionalProperties === 'boolean'
  check(ok, `${tool.name} output.schema 声明合规`)
}

// ---- 真实后端联调（可选）----
const API = process.env.AGENTMATRIX_API ?? 'http://127.0.0.1:8000/api/v1'
let backendUp = false
try {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'ops@agentmatrix.local', password: 'AgentMatrix@2026' }),
  })
  backendUp = res.ok
} catch {
  backendUp = false
}

if (!backendUp) {
  console.log('\n5) 后端未启动，跳过执行类断言')
} else {
  console.log('\n5) 执行类断言（连真实后端）')

  const matrixTool = registered.find((t) => t.name === 'agentmatrix_matrix_coverage')
  const matrix = await matrixTool.execute({})
  check(typeof matrix.coverage === 'number' && matrix.total_cells > 0, `矩阵覆盖率 = ${matrix.coverage}`)
  check(Array.isArray(matrix.gaps), `缺口列表可读（${matrix.gaps.length} 个）`)

  const createTool = registered.find((t) => t.name === 'agentmatrix_create_task')
  const created = await createTool.execute({
    title: `DSH 插件联调 ${new Date().toLocaleTimeString('zh-CN')}`,
    workflow_code: 'order_delay_exception',
    payload: { order_id: `SO-DSH-${Date.now().toString().slice(-6)}`, quantity: 120 },
    priority: 3,
    complexity_hint: 3,
  })
  check(typeof created.task_id === 'string' && created.task_id.length === 32, `建任务成功 ${created.task_id.slice(0, 8)}`)
  check(typeof created.assigned_to === 'string', `已分配智能体：${created.assigned_to}`)
  check(Array.isArray(created.top_factors) && created.top_factors.length > 0, `返回打分拆解 ${created.top_factors.length} 项`)

  if (created.run_id) {
    const runTool = registered.find((t) => t.name === 'agentmatrix_run_status')
    const run = await runTool.execute({ run_id: created.run_id })
    check(typeof run.status === 'string', `运行状态：${run.status}`)
    check(Array.isArray(run.steps), `步骤数 ${run.steps.length}`)
  }

  const explainTool = registered.find((t) => t.name === 'agentmatrix_explain_dispatch')
  const explained = await explainTool.execute({ task_id: created.task_id })
  check(explained.strategy != null, `可解释调度：策略 ${explained.strategy}`)
}

console.log('')
if (failures > 0) {
  console.log(`插件测试失败：${failures} 项`)
  process.exit(1)
}
console.log('插件测试全部通过')
