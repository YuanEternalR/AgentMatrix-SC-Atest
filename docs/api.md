# 接口文档

> 面向：前端开发、联调、答辩演示。
> 机器可读版本（含全部 schema）：`http://127.0.0.1:8000/docs`（Swagger UI）与 `/openapi.json`。
> 本文只写"怎么调、字段是什么、错了怎么办"，示例均为真实响应裁剪。

## 1. 通用约定

| 项 | 说明 |
|---|---|
| Base URL | `http://127.0.0.1:8000/api/v1` |
| 前端入口 | `http://127.0.0.1:5173`（Vite 把 `/api` 代理到后端） |
| 鉴权 | `Authorization: Bearer <access_token>`，除登录与 `/health` 外都需要 |
| 编码 | 响应头为 `application/json; charset=utf-8` |
| 时间 | ISO 8601 UTC（如 `2026-11-22T03:17:48.460750Z`） |
| ID | 32 位十六进制字符串 |
| 列表 | 单页上限 200，默认 50（`limit` 参数） |

### 1.1 错误格式

**单条错误**（401/403/404/409）：

```json
{ "detail": "审批已处理（approved）" }
```

**字段校验错误**（422，Pydantic 标准结构）：

```json
{
  "detail": [
    {
      "type": "less_than_equal",
      "loc": ["body", "priority"],
      "msg": "Input should be less than or equal to 5",
      "input": 9,
      "ctx": { "le": 5 }
    }
  ]
}
```

**工作流图校验失败**（422，业务自定义结构）：

```json
{
  "detail": {
    "message": "图校验未通过",
    "ok": false,
    "errors": [{ "code": "CYCLE", "message": "存在环：a → b → a", "node_id": "a" }],
    "warnings": [{ "code": "UNREACHABLE", "message": "节点 end 从入口不可达", "node_id": "end" }]
  }
}
```

### 1.2 状态码一览

| 码 | 含义 | 典型场景 |
|---|---|---|
| 200 | 成功 | 查询、更新 |
| 201 | 已创建 | 建任务、建规则、存工作流版本 |
| 204 | 无内容 | 删除规则 |
| 401 | 未认证 | 无令牌 / 令牌过期（`{"detail":"Not authenticated"}`） |
| 403 | 无权限 | 只读角色发起任务：`{"detail":"需要角色 ['admin','developer','operator']，当前为 viewer"}` |
| 404 | 不存在 | 任务/运行/审批/工作流/死信不存在 |
| 409 | 状态冲突 | 审批已处理、运行已结束无法取消、工作流无已发布版本 |
| 422 | 校验失败 | 字段不合法、工作流图校验未通过 |

### 1.3 角色与权限

| 角色 | 可做 |
|---|---|
| `admin` | 全部（自动包含下列所有权限） |
| `developer` | 工作流保存、告警规则增删改、审批、发起任务 |
| `operator` | 发起任务、审批、死信重试/忽略、手动评估告警 |
| `viewer` | 只读 |

---

## 2. 鉴权

### POST `/auth/login`

表单提交（`application/x-www-form-urlencoded`），字段为 `username`（邮箱）与 `password`。

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user": {
    "id": "5334c2e4ca654d379c906cc176497403",
    "email": "ops@agentmatrix.local",
    "name": "运营专员",
    "role": "operator"
  }
}
```

失败统一返回 401 `{"detail":"邮箱或密码错误"}`——不区分"邮箱不存在"与"密码错"，避免账号枚举。

### GET `/auth/me`

返回当前用户，用于前端刷新页面后恢复登录态。

---

## 3. 任务

### POST `/tasks`（operator / developer）

```json
{
  "title": "订单 SO-DOC-001 延迟异常处理",
  "workflow_code": "order_delay_exception",
  "priority": 1,
  "complexity_hint": 4,
  "payload": { "order_id": "SO-DOC-001", "quantity": 420 },
  "deadline_in_sec": 600,
  "idempotency_key": "optional-unique-key"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | ✅ | 1–200 字符 |
| `workflow_code` | string | ✅ | 必须指向存在且有已发布版本的工作流 |
| `payload` | object | | 业务参数，原样传给工作流节点 |
| `priority` | int | | 1（最高）–5，默认 3 |
| `complexity_hint` | int | | 1–5，路由器的任务复杂度预判 |
| `deadline_in_sec` | int | | 相对当前时间的截止秒数，转成 `deadline_at` |
| `idempotency_key` | string | | 相同键重复提交会返回**已存在的任务**，不会重复创建 |

**响应 201**（节选，`decision` 是调度层的核心产出）：

```json
{
  "id": "e562a3c7f070483faf30bec04c0e694c",
  "status": "queued",
  "priority": 1,
  "complexity_hint": 4,
  "required_capabilities": ["order_query", "impact_assess"],
  "run_id": "ef1cb1239d4e4bbeb8739db90e6e3f94",
  "run_status": "queued",
  "workflow_code": "order_delay_exception",
  "decision": {
    "strategy": "s4_llm_planner",
    "agent_code": "fulfillment-triage",
    "score": 0.975,
    "planned_by": "llm",
    "reason": "复杂度 4/5 或高优先级，需要强推理能力",
    "fallback_reason": null,
    "factors": [
      { "name": "capability", "raw": 1.0, "weight": 0.5, "contribution": 0.5, "detail": "大模型规划选中的智能体" },
      { "name": "success", "raw": 0.95, "weight": 0.5, "contribution": 0.475, "detail": "历史成功率 95%" }
    ],
    "rejected": [
      { "agent_code": "express-triage", "reason": "已达并发上限 4/4" },
      { "agent_code": "inventory-optimizer", "reason": "缺少能力: impact_assess, order_query" }
    ]
  }
}
```

> `factors` 是**可解释性**的载体：每个因子的 `contribution` 之和等于 `score`。
> `rejected` 记录硬过滤淘汰原因，前端直接展示"为什么没派给它"。

`status` 取值：`pending`（无可用智能体，等队列）/ `queued` / `running` / `waiting_approval` / `succeeded` / `failed` / `canceled`。

### GET `/tasks`

查询参数：`limit`（1–200，默认 50）、`status`。

### GET `/tasks/{task_id}`

返回 `TaskDetailOut`：在任务字段基础上带 `run_id`、`run_status`、`workflow_code`、`decision`。

---

## 4. 运行

### GET `/runs`

查询参数：`limit`、`status`。

### GET `/runs/{run_id}`

```json
{
  "id": "ef1cb1239d4e4bbeb8739db90e6e3f94",
  "task_id": "e562a3c7f070483faf30bec04c0e694c",
  "status": "waiting_approval",
  "trigger": "api",
  "trace_id": "d310eaf03be84064aade8f32ba0206bf",
  "started_at": "2026-11-22T03:17:48.460750Z",
  "finished_at": null,
  "cost_usd": 0.001498,
  "token_input": 75,
  "token_output": 131,
  "error_code": null,
  "workflow_version": 4,
  "graph": { "entry": "start", "nodes": [{ "id": "start", "type": "start", "next": "fetch_order" }] },
  "steps": [
    {
      "id": "7d84d79e69c945f69c4dec882539e0e4",
      "node_id": "start",
      "node_type": "start",
      "status": "succeeded",
      "attempt": 1,
      "input": { "_attempt": 1, "order_id": "SO-DOC-001", "quantity": 420 },
      "output": { "started": true },
      "error": {},
      "started_at": "2026-11-22T03:17:48.460750Z",
      "finished_at": "2026-11-22T03:17:48.465440Z",
      "tokens": 0,
      "cost_usd": 0.0
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `workflow_version` | 运行锁定的工作流版本号（不可变） |
| `graph` | 工作流图，前端据此渲染 DAG |
| `steps[].attempt` | 同一节点的第几次尝试（重试会新增步骤记录） |
| `steps[].error` | 失败时含 `{code, message, retry_in_sec, next_attempt}` |
| `trigger` | `api` / `manual` / `cron` / `webhook` / `subtask` |

步骤状态：`pending` / `running` / `succeeded` / `failed` / `skipped` / `retrying` / `waiting_approval`。

### POST `/runs/{run_id}/cancel`（operator / developer）

已结束的运行返回 409。

---

## 5. 审批

### GET `/approvals`

查询参数：`pending_only`（默认 `true`）。

```json
{
  "id": "af45c6bd7014464d9e8dc65384f6d215",
  "run_id": "ef1cb1239d4e4bbeb8739db90e6e3f94",
  "step_id": "3f87e13c041444bc8f90f51581759beb",
  "status": "pending",
  "assignee_role": "operator",
  "decision": null,
  "comment": "",
  "created_at": "2026-11-22T03:17:48Z",
  "decided_at": null
}
```

### POST `/approvals/{approval_id}/decision`

```json
{ "decision": "approved", "comment": "影响等级高，同意补偿" }
```

`decision` 只能是 `approved` 或 `rejected`。

- 通过 → 运行回到 `queued`，Worker 从 `cursor_node_id` 继续；审批步骤状态改为 `succeeded`。
- 驳回 → 运行 `failed`，`error_code = APPROVAL_REJECTED`。
- 重复决策 → 409 `{"detail":"审批已处理（approved）"}`。

---

## 6. 工作流

### GET `/workflows`

```json
[
  {
    "code": "order_delay_exception",
    "name": "订单延迟异常闭环",
    "stage": "fulfillment",
    "published_version": 4,
    "required_capabilities": ["order_query", "impact_assess"],
    "node_count": 8
  }
]
```

### GET `/workflows/{code}`

返回最新版本号、`graph`、以及全部版本列表（版本号、状态、变更说明、节点数、发布时间）。

### GET `/workflows/{code}/diff`

查询参数：`from`、`to`（版本号）。对比同一工作流的两个版本，布局坐标 `pos` 不参与语义比较。

```json
{
  "code": "order_delay_exception",
  "from": 1,
  "to": 2,
  "from_changelog": "初始版本",
  "to_changelog": "执行节点改为由调度决策决定智能体（$dispatch）",
  "summary": { "nodes_added": 0, "nodes_removed": 0, "nodes_changed": 1, "edges_added": 0, "edges_removed": 0, "entry_changed": false },
  "nodes_added": [],
  "nodes_removed": [],
  "nodes_changed": [
    { "node_id": "evaluate", "fields": [{ "field": "agent_code", "from": "fulfillment-triage", "to": "$dispatch" }] }
  ],
  "edges_added": [],
  "edges_removed": [],
  "entry": { "from": "start", "to": "start", "changed": false }
}
```

### POST `/workflows/{code}/validate`（developer）

只校验不保存，供设计器实时提示。请求体 `{ "graph": {...} }`，返回：

```json
{
  "ok": false,
  "errors":   [{ "code": "CYCLE", "message": "存在环：a → b → a", "node_id": "a" }],
  "warnings": [{ "code": "UNREACHABLE", "message": "节点 end 从入口不可达", "node_id": "end" }]
}
```

校验项：`EMPTY_GRAPH`、`NODE_INVALID`、`DUPLICATE_NODE_ID`、`ENTRY_MISSING`、`ENTRY_NOT_FOUND`、`NO_START`、`NO_END`、`BAD_NODE_TYPE`、`SKILL_MISSING`、`AGENT_MISSING`、`ROLE_MISSING`、`EXPR_MISSING`、`BRANCH_MISSING`、`END_HAS_NEXT`、`DANGLING_EDGE`、`CYCLE`；警告：`UNREACHABLE`。

### POST `/workflows/{code}/versions`（developer）

```json
{ "graph": { "entry": "start", "nodes": [...] }, "changelog": "设计器保存" }
```

- 校验不通过 → 422，返回上面的结构化错误。
- 通过 → 201，新建**下一个版本号**并直接发布：

```json
{ "code": "order_delay_exception", "version": 5, "status": "published", "changelog": "设计器保存", "warnings": [] }
```

> 已发布版本不可变：这是"运行可复现"的前提，不会原地修改历史版本。

### 图结构

```json
{
  "entry": "start",
  "required_capabilities": ["order_query", "impact_assess"],
  "nodes": [
    { "id": "start", "type": "start", "next": "fetch_order" },
    { "id": "fetch_order", "type": "skill", "skill": "order_status_query", "next": "assess" },
    { "id": "evaluate", "type": "agent", "agent_code": "$dispatch", "next": "gate" },
    { "id": "gate", "type": "condition", "expr": "assess.impact_score >= 3", "on_true": "approve", "on_false": "notify" },
    { "id": "approve", "type": "approval", "role": "operator", "next": "notify" },
    { "id": "end", "type": "end" }
  ]
}
```

| 节点类型 | 必填字段 | 说明 |
|---|---|---|
| `start` | `next` | 入口，`entry` 必须指向它 |
| `end` | — | 不能有 `next` |
| `skill` | `skill`、`next` | `skill` 为技能编码 |
| `agent` | `agent_code`、`next` | `agent_code` 为 `$dispatch` 时由调度决策决定执行者 |
| `condition` | `expr`、`on_true`、`on_false` | 表达式仅支持比较 / `in` / 空值判断，不执行代码 |
| `approval` | `role`、`next` | `role` 决定谁能批 |

`input_from: ["node_id", ...]` 用于把上游节点输出合并进当前节点输入。

---

## 7. 智能体与矩阵

### GET `/agents`、GET `/agents/{code}`

列出全部智能体（含 `model_tier`、`success_rate`、`avg_cost_usd`、`p95_latency_ms`、`max_concurrency`、`published_version`）；详情额外返回版本列表与系统提示词。

### GET `/matrix`

```json
{
  "stages": [{ "code": "demand", "label": "需求计划" }],
  "categories": [{ "code": "perception", "label": "感知与解析" }],
  "cells": [
    { "stage": "demand", "category": "perception", "covered": false, "agents": [] }
  ],
  "coverage": 0.7857,
  "total_cells": 28,
  "covered_cells": 22,
  "gap_count": 6,
  "gaps": [{ "stage": "demand", "stage_label": "需求计划", "category": "perception", "category_label": "感知与解析" }],
  "agent_count": 10
}
```

---

### 可视化数据

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/graphs/collaboration` | 智能体 ↔ 技能 调用拓扑（`limit_runs` 默认 200） |
| GET | `/graphs/sankey` | 任务流转桑基：来源 → 智能体 → 结果（`limit_tasks` 默认 500） |
| GET | `/business` | 业务日指标（`days` 7–90，默认 30） |

**协作拓扑**：节点大小 = 调用次数，边权重 = 相邻调用频次。

```json
{
  "nodes": [
    { "id": "agent::fulfillment-triage", "name": "fulfillment-triage", "kind": "agent", "calls": 33 },
    { "id": "skill::order_status_query", "name": "order_status_query", "kind": "skill", "calls": 30 }
  ],
  "edges": [{ "source": "skill::order_status_query", "target": "agent::fulfillment-triage", "weight": 30 }],
  "run_count": 76
}
```

**桑基图**：

```json
{
  "nodes": [{ "name": "API 调用", "layer": "source" }, { "name": "fulfillment-triage", "layer": "agent" }, { "name": "成功", "layer": "result" }],
  "links": [{ "source": "API 调用", "target": "fulfillment-triage", "value": 33 }]
}
```

**业务看板**：数据来自 `business_daily` 表（种子数据，幂等生成 30 天）。

```json
{
  "days": ["2026-10-24", "2026-10-25"],
  "otif_rate": [0.932, 0.918],
  "inventory_turnover": [5.94, 5.81],
  "stockout_rate": [0.023, 0.028],
  "logistics_cost_usd": [12998.4, 12310.1],
  "supplier_risk": { "high": [2, 1], "medium": [5, 6], "low": [12, 10] },
  "latest": { "otif_rate": 0.932, "inventory_turnover": 5.94, "stockout_rate": 0.023, "logistics_cost_usd": 12998.4 },
  "seeded": true
}
```

> `otif_rate` / `stockout_rate` 是 0–1 的小数，前端自行乘 100 显示。

---

## 8. 监控与告警

### GET `/metrics`

查询参数：`hours`（1–168，默认 24）。

```json
{
  "window_hours": 24,
  "totals": {
    "runs": 15, "finished": 10, "succeeded": 10, "failed": 0,
    "running": 0, "waiting_approval": 5,
    "success_rate": 1.0,
    "p50_ms": 1179.3, "p95_ms": 37388.5,
    "p50_active_ms": 41.4, "p95_active_ms": 230.8,
    "cost_usd": 0.0208, "avg_cost_usd": 0.0021, "tokens": 6998
  },
  "trend": [{ "hour": "11-22 10:00", "succeeded": 3, "failed": 0, "other": 1 }],
  "by_agent": [{ "agent_code": "fulfillment-analyst", "runs": 6, "succeeded": 6, "failed": 0, "cost_usd": 0.0042, "success_rate": 1.0 }],
  "by_workflow": [{ "workflow_code": "fulfillment_review", "runs": 9, "succeeded": 6, "failed": 0 }],
  "recent_failures": []
}
```

> **两个耗时口径必须分开看**：`p95_active_ms` 是步骤耗时之和（引擎真实开销），`p95_ms` 是端到端（含人工审批等待）。混用会把"审批慢"误读成"引擎慢"。

### 告警规则

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/alert-rules` | 登录 |
| POST | `/alert-rules` | developer |
| PATCH | `/alert-rules/{id}` | developer |
| DELETE | `/alert-rules/{id}` | developer |
| POST | `/alert-rules/evaluate` | operator / developer |

```json
{
  "name": "死信积压",
  "metric": "dead_letters",
  "operator": ">",
  "threshold": 0,
  "severity": "critical",
  "description": "只要有待处理死信就告警"
}
```

可用 `metric`：`success_rate`、`failed_runs`、`running_runs`、`waiting_approval`、`p95_active_ms`、`p95_ms`、`cost_usd`、`dead_letters`。
可用 `operator`：`>`、`>=`、`<`、`<=`、`==`。
`severity`：`info` / `warning` / `critical`。

评估由 Worker 每 30 秒执行一次；同一规则同时只有一条未关闭事件（去重），条件恢复后自动关闭。

### 告警事件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/alert-events` | `only_open` 默认 `true` |
| POST | `/alert-events/{id}/ack` | 标记已确认 |
| POST | `/alert-events/{id}/resolve` | 手动恢复 |

---

## 9. 死信

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/dead-letters` | 登录（`only_pending` 默认 `true`） |
| POST | `/dead-letters/{id}/retry` | operator / developer |
| POST | `/dead-letters/{id}/ignore` | operator / developer |

`retry` 会把运行重置为 `queued` 并把游标指回失败节点；`ignore` 仅归档。

```json
{
  "id": "68934837477a4710b7b48cfe226a7c64",
  "run_id": "e35fbe28f63b4fb8af791611b5492e2f",
  "task_id": "400a93f0ac2e4531bc03725f35412b7f",
  "node_id": "notify",
  "error_code": "TRANSIENT",
  "message": "通知网关持续不可用（第 3 次尝试）",
  "attempts": 3,
  "status": "pending"
}
```

---

## 10. 产物

### GET `/artifacts`

查询参数：`run_id`（可选）、`limit`。

### GET `/artifacts/{artifact_id}/download`

返回文件内容，`Content-Disposition` 用 RFC 5987 编码中文文件名：

```
Content-Disposition: attachment; filename*=UTF-8''%E6%99%BA%E8%83%BD%E4%BD%93...md
```

前端需要带 Bearer 头，所以用 `fetch` + `blob` 而不是裸链接。

---

## 11. 运维

### GET `/health`

依赖健康检查；数据库或 Redis 不可用时返回 **503**。

```json
{ "status": "ok", "checks": { "database": "ok", "redis": "ok" } }
```

### GET `/meta`

返回系统名称、版本、环境与**当前调度策略**及全部策略说明——前端启动时用它渲染侧边栏。

---

## 12. 调用示例

### PowerShell

```powershell
$base = 'http://127.0.0.1:8000/api/v1'
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post `
  -Body @{ username='ops@agentmatrix.local'; password='AgentMatrix@2026' } `
  -ContentType 'application/x-www-form-urlencoded'
$h = @{ Authorization = "Bearer $($login.access_token)" }

# 中文请求体必须用 UTF-8 字节，否则会变成 '?'
$body = @{ title='订单异常'; workflow_code='order_delay_exception'; payload=@{ order_id='SO-001' } } | ConvertTo-Json -Depth 5
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Uri "$base/tasks" -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' -Headers $h
```

### curl

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -d "username=ops@agentmatrix.local&password=AgentMatrix@2026" | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s http://127.0.0.1:8000/api/v1/metrics -H "Authorization: Bearer $TOKEN"
```

---

## 13. 已知限制

1. 分页只有 `limit`，没有游标或页码——演示规模够用，数据量大时需补 `offset`/`cursor`。
2. 无版本对比接口（只能分别取两个版本自行比较）。
3. 告警渠道只有站内，`channel` 字段已预留但未实现 webhook 外发。
4. 产物内容存库，单文件体积不宜过大。
