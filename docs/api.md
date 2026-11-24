# 接口文档

> 最后更新：2026-11-23
> 覆盖 OpenAPI 的 **52 条路径 / 60 个操作**（含根路径 `GET /health` 与 `GET /api/v1/meta`）。
> 面向：前端开发、联调。
> 机器可读版本（含全部 schema）：`http://127.0.0.1:8000/docs`（Swagger UI）与 `/openapi.json`。
> 本文件只写调用方式、字段定义与错误处理，示例均为真实响应裁剪。

## 1. 通用约定

| 项 | 说明 |
|---|---|
| Base URL | `http://127.0.0.1:8000/api/v1` |
| 前端入口 | `http://127.0.0.1:5173`（Vite 把 `/api` 代理到后端） |
| 鉴权 | `Authorization: Bearer <access_token>`，除登录、`/health`、`/meta` 外都需要 |
| 编码 | 响应头为 `application/json; charset=utf-8` |
| 时间 | ISO 8601 UTC（如 `2026-11-22T03:17:48.460750Z`；字典型响应用 `+00:00` 偏移） |
| ID | 32 位十六进制字符串 |
| 列表 | 单页上限 200；默认 50（订单与审计为 20、技能为 100），`limit` 参数 |

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
| `developer` | 建技能/智能体并发布版本、保存工作流、告警规则增删改、审批、发起任务、查审计 |
| `operator` | 发起任务、审批、死信重试/忽略、手动评估告警、启停告警规则（仅 `enabled`）、**试运行技能/智能体**、查审计 |
| `viewer` | 只读；不能建技能与智能体，**看不到审计日志**（403） |

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
| `title` | string | 是 | 1–200 字符 |
| `workflow_code` | string | 是 | 必须指向存在且有已发布版本的工作流 |
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
> `rejected` 记录硬过滤淘汰原因，前端可直接展示。

`status` 取值：`pending`（无可用智能体，等队列）/ `queued` / `running` / `waiting_approval` /
`succeeded` / `failed` / `canceled` / `timed_out`（超时；与运行状态同步）。

### GET `/tasks`

查询参数：`limit`（1–200，默认 50）、`offset`、`status`、`q`（标题/编号）、
`order`（`created_at` 按创建时间倒序 / `risk` 高风险优先）。总数在 `X-Total-Count` 响应头。

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
    "published_version": 5,
    "required_capabilities": ["order_query", "impact_assess"],
    "node_count": 8
  }
]
```

### GET `/workflows/{code}`

返回 `latest_version`（最新版本号）、`graph`、以及全部版本列表（版本号、状态、变更说明、节点数、发布时间）。

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

- 校验不通过 → 422，返回上述结构化错误。
- 通过 → 201，新建**下一个版本号**并直接发布：

```json
{ "code": "order_delay_exception", "version": 6, "status": "published", "changelog": "设计器保存", "warnings": [] }
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

## 6.1 订单（真实数据）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/orders` | 真实订单列表；`limit` 1–200（默认 20）、`offset`、`status`、`region`、`q`（订单号/城市/品类）、`order`（`delay` 按延迟倒序 / `recent` 按日期倒序）；总数在 `X-Total-Count` |
| GET | `/orders/stats` | 整体履约分布：`total`、`otif_rate`、`late_rate`、`avg_delay_days`，以及按地区、按运输方式的延迟统计 |
| GET | `/orders/{order_id}` | 单条订单明细（数据来自 `supply_orders`）；不存在返回 404 |

统计口径（当前真实数据，DataCo 65,752 单）：

```json
{
  "source": "dataco",
  "total": 65752,
  "shipping_on_time": 11722,
  "late_delivery": 36048,
  "advance_shipping": 15127,
  "otif_rate": 0.1783,
  "late_rate": 0.5482,
  "avg_delay_days": 0.567
}
```

`otif_rate` / `late_rate` 是 0–1 小数，前端自行乘 100 显示。
`otif_rate` 的口径是「`Delivery Status = Shipping on time` ÷ 总单」= 11,722/65,752，
**不含 in-full**，因此是准时率而非严格 OTIF（原因见 [data-sources.md](data-sources.md)）。

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
  "coverage": 0.8125,
  "total_cells": 32,
  "covered_cells": 26,
  "gap_count": 6,
  "gaps": [{ "stage": "demand", "stage_label": "需求计划", "category": "perception", "category_label": "感知与解析" }],
  "agent_count": 34
}
```

> 矩阵为 8 阶段 × 4 能力 = 32 格。`agent_count` 是当前演示库的数量（含界面/测试新建的）；种子数据为 15 个智能体、15 个技能。

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
    { "id": "agent::express-triage", "name": "履约应急快线智能体", "kind": "agent", "calls": 21 },
    { "id": "skill::order_status_query", "name": "订单状态查询", "kind": "skill", "calls": 43 }
  ],
  "edges": [{ "source": "skill::customer_impact_assess", "target": "agent::express-triage", "weight": 19 }],
  "run_count": 53
}
```

**桑基图**：

```json
{
  "nodes": [{ "name": "API 调用", "layer": "source" }, { "name": "履约应急快线智能体", "layer": "agent" }, { "name": "成功", "layer": "result" }],
  "links": [
    { "source": "API 调用", "target": "履约应急快线智能体", "value": 20 },
    { "source": "履约应急快线智能体", "target": "成功", "value": 18 }
  ]
}
```

**业务看板**：数据来自 `supply_orders`（DataCo，65,752 单），按 `order_date` 聚合；`days` 7–90，默认 30。

```json
{
  "days": ["2018-01-25", "2018-01-26", "2018-01-27", "2018-01-28", "2018-01-29", "2018-01-30", "2018-01-31"],
  "otif_rate": [0.1324, 0.1884, 0.1618, 0.2319, 0.1765, 0.2029, 0.1765],
  "late_rate": [0.6176, 0.5652, 0.6176, 0.5652, 0.5147, 0.5072, 0.5735],
  "avg_delay_days": [0.632, 0.522, 0.809, 0.652, 0.529, 0.623, 0.618],
  "orders": [68, 69, 68, 69, 68, 69, 68],
  "sales": [2703.0, 9609.48, 14675.76, 14891.58, 14675.76, 14891.58, 14407.34],
  "latest": { "otif_rate": 0.1765, "late_rate": 0.5735, "avg_delay_days": 0.618, "orders": 68, "sales": 14407.34 },
  "total_orders": 65752,
  "source": "dataco"
}
```

> `otif_rate` / `late_rate` 是 0–1 的小数，前端自行乘 100 显示。

---

## 8. 监控与告警

### GET `/metrics`

查询参数：`hours`（1–168，默认 24）。

```json
{
  "window_hours": 24,
  "totals": {
    "runs": 54, "finished": 53, "succeeded": 52, "failed": 1,
    "running": 0, "waiting_approval": 1,
    "success_rate": 0.9811,
    "p50_ms": 3039.1, "p95_ms": 30873.3, "median_ms": 2971.7,
    "p50_active_ms": 2341.9, "p95_active_ms": 11660.9,
    "cost_usd": 0.017019, "avg_cost_usd": 0.000321, "tokens": 25145
  },
  "trend": [{ "hour": "11-23 10:00", "succeeded": 2, "failed": 1, "other": 0 }],
  "by_agent": [{ "agent_code": "express-triage", "runs": 26, "succeeded": 24, "failed": 1, "cost_usd": 0.007751, "success_rate": 0.96 }],
  "by_workflow": [{ "workflow_code": "order_delay_exception", "runs": 49, "succeeded": 47, "failed": 1 }],
  "recent_failures": [{ "run_id": "acd8ba3db79c46ff9ff394ea7d801f34", "status": "failed", "error_code": "BUSINESS", "created_at": "2026-11-23T10:23:41.300127+00:00" }]
}
```

> **两个耗时口径必须分开看**：`p95_active_ms` 是步骤耗时之和（引擎真实开销），`p95_ms` 是端到端（含人工审批等待）。混用会把"审批慢"误读成"引擎慢"。

### 告警规则

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/alert-rules` | 登录 |
| POST | `/alert-rules` | developer |
| PATCH | `/alert-rules/{id}` | operator（仅 `enabled`）/ developer（阈值、级别） |
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

## 11. 审计（只读）

三张接口都**没有写操作**：审计由业务路由内部写入（`services/audit.record()`），
数据库触发器还会拒绝 `UPDATE` / `DELETE`。可见角色：管理员、开发者、运营；只读角色 **403**。

### GET `/audit-logs`

查询参数：

| 参数 | 说明 |
|---|---|
| `action` | 动作编码，可逗号分隔多个，如 `auth.login,approval.decide` |
| `resource_type` | `user` / `task` / `run` / `approval` / `workflow` / `agent` / `skill` / `dead_letter` / `alert_rule` / `alert_event` / `dispatch` / `workbench`（共 12 类，与 `/audit-logs/summary` 的选项表一致） |
| `q` | 关键词，匹配摘要、操作者与对象编号 |
| `days` | 时间窗口，默认 30 |
| `limit` / `offset` | 分页；总数在 `X-Total-Count` 响应头 |

```json
[
  {
    "id": "…",
    "actor_name": "运营专员",
    "actor_role_label": "运营",
    "action": "approval.decide",
    "action_label": "审批决策",
    "resource_type_label": "审批",
    "resource_id": "ffd801d11c73",
    "summary": "运营专员 对运行 c001336a 的审批节点作出「通过」",
    "before": { "status": "pending", "assignee_role": "operator" },
    "after": { "status": "approved", "decision": "approved", "comment": "同意" },
    "ip": "172.18.0.1",
    "created_at": "2026-11-23T03:37:40+00:00"
  }
]
```

`before` / `after` 只含**被改动的字段**，两侧字段集合一致；值在落库前已脱敏
（密钥、Bearer、邮箱、手机号）。

### GET `/audit-logs/summary`

`days` 窗口内的总数、今日数、操作者数、按动作分布，外加动作与对象的**中文选项表**
（前端筛选项直接用，不必再维护一份映射）。`days` 默认 7（1–365），与列表接口的默认 30 不同。

### GET `/audit-logs/export.csv`

导出当前筛选结果（`action` / `resource_type` / `q` / `days` 同列表接口），UTF-8 BOM + 中文表头，
Excel 可直接打开；`limit` 默认 5000、上限 20,000（导出不分页）。

```
Content-Disposition: attachment; filename="audit-logs-20261123-1141.csv"
```

---

## 12. 技能

### GET `/skills`

列表。`q` 关键词、`type`（builtin / http）筛选；总数在 `X-Total-Count`。
每项含 `runs / success_rate / avg_ms`（来自 `skill_runs`，没测过为 `null`）
与 `reference_count`（被多少已发布版本引用）。

### GET `/skills/{code}`

详情：`config`（**已脱敏**）、`input_schema`、`output_schema`、`references`（引用方与版本）、
`recent_runs`（最近 10 次执行）。

### GET `/skills/registry`

内置函数清单，建技能时从下拉里选。

### POST `/skills`（developer）

```json
{
  "code": "carrier_quote",
  "name": "承运商实时报价",
  "category": "external",
  "type": "http",
  "input_schema": { "carrier": { "type": "string", "required": true, "label": "承运商" } },
  "config": {
    "method": "GET",
    "url": "https://api.example.com/quote?carrier={{carrier}}",
    "mock": true,
    "mock_delay_ms": 120,
    "mock_response": "{\"quote\": 128.5, \"carrier\": \"{{carrier}}\"}"
  },
  "timeout_sec": 30
}
```

约束：

- `type=sql|mcp` 返回 **422**（未实现）；
- `mock=false` 时必须给 `url`，且要过 SSRF 检查（回环/内网/链路本地/保留地址一律 422，
  域名白名单除外）；
- 配置里的鉴权只允许 `auth.token_env`（环境变量名），响应统一打码。

### POST `/skills/{code}/versions`（developer）

改配置 = 发新版本（`version` 自增，旧配置进审计快照）。同一接口改 `description`、
`input_schema`、`output_schema`、`timeout_sec`。

### POST `/skills/{code}/test`（operator / developer）

```json
{ "inputs": { "carrier": "Standard Class" }, "force_mock": true }
```

`force_mock` 只覆盖**本次**执行，不改库。返回：

```json
{ "ok": true, "output": { "quote": 128.5 }, "duration_ms": 162.4,
  "mode": "http-mock", "error": "", "error_code": "" }
```

失败时仍返回 200 且 `ok=false`，`error_code` 是错误分类（如 `TRANSIENT`）——
试运行用于观察失败，不用 HTTP 500 表达。

### DELETE `/skills/{code}`（developer）

被**已发布**智能体版本或工作流版本引用时返回 **409**，body 里有 `references`；
未被引用返回 **204**。

---

## 13. 智能体

### GET `/agents`、`GET /agents/{code}`

列表带 `published_version`、`skill_count`。详情多出：`published` / `draft`（草稿与已发布的内容）、
`skills`（解析后的技能名）、`versions`（全部版本）、`recent_steps`（最近 10 次步骤）。

### POST `/agents`（developer）

新建即产生 **草稿 v1**，不发布。`skill_ids` 里出现不存在的技能返回 422。

### PATCH `/agents/{code}`（developer）

改智能体层面的元数据（名称、阶段、能力标签、档位、并发、P95、均价、状态），
不动版本内容——提示词与技能绑定走 `/versions`。

### POST `/agents/{code}/versions`（developer）

```json
{
  "system_prompt": "你是运价核对专员……",
  "skill_ids": ["carrier_quote"],
  "changelog": "补充风险标注",
  "publish": true
}
```

- `publish=true`：新版本置 `published`，**上一个已发布版本置 `archived`**（同一时刻只有一个 published）；
- `publish=false`：只存草稿，不影响线上；
- 请求体中模型配置的字段名是 `model_config`（内部字段名为 `llm_config`，
  `model_config` 是 Pydantic v2 的保留名）。

### POST `/agents/{code}/test`（operator / developer）

```json
{ "input": { "carrier": "Standard Class" }, "use_mock": true }
```

先逐个执行绑定技能，再调模型，返回轨迹：

```json
{
  "ok": true, "version": 2, "version_status": "published",
  "trace": [
    { "kind": "tool", "label": "调用技能「承运商实时报价」", "ok": true, "duration_ms": 160.1, "tokens": 0,
      "output": { "quote": 128.5 } },
    { "kind": "llm", "label": "模型分析（mock）", "ok": true, "duration_ms": 0.1, "tokens": 237,
      "cost_usd": 0.000121 }
  ],
  "output": "……", "tokens": 237, "cost_usd": 0.000121, "duration_ms": 160.2
}
```

测试优先用**已发布版本**，没有则用最新草稿（`version_status` 会写明）。

---

## 14. 运维

### GET `/health`

依赖健康检查；数据库或 Redis 不可用时返回 **503**。

```json
{ "status": "ok", "checks": { "database": "ok", "redis": "ok" } }
```

### GET `/meta`

返回系统名称、版本、环境与**当前调度策略**及全部策略说明——前端启动时用它渲染侧边栏。

---

## 15. 系统设置

### GET `/settings/dispatch`

返回当前配置、来源（`env` 未改过 / `db` 界面改过）、默认值、五种策略说明与六因子说明：

```json
{
  "config": { "strategy": "s4_llm_planner",
              "weights": { "capability": 0.35, "success": 0.2, "load": 0.15,
                           "cost": 0.1, "latency": 0.1, "affinity": 0.1 },
              "sla_headroom": 0.8, "min_success_rate": 0.85 },
  "source": "db",
  "strategies": [ { "name": "s2_weighted", "label": "加权打分（产品基线）", "description": "能力 35% / 成功率 20% / 负载 15% / 成本 10% / 时延 10% / 亲和 10%。", "research_role": "产品基线策略：平衡质量、成本与负载，可解释性最强；实际默认值以 /settings/dispatch 为准。" } ],
  "factors": [ { "code": "capability", "label": "能力匹配", "description": "..." } ]
}
```

### PUT `/settings/dispatch`（developer）

```json
{ "strategy": "s2_weighted", "weights": { "capability": 0.4, "success": 0.25, "load": 0.15,
  "cost": 0.1, "latency": 0.05, "affinity": 0.05 }, "sla_headroom": 0.8, "min_success_rate": 0.85 }
```

- 权重不必和为 1（内部按总和归一）；只传部分字段时其余保持当前值；
- 非法输入返回 **422** 并说明原因（负权重、全零、未知策略/字段、SLA 余量越界）；
- 保存写 `system_settings`，**下一次调度即生效**，无需重启；变更记 `dispatch.configure`（含改前/改后）。

### POST `/settings/dispatch/preview`

```json
{ "required_capabilities": ["order_query"], "priority": 1, "complexity_hint": 4,
  "weights": { "capability": 0.5 }, "strategy": "s2_weighted" }
```

用**真实候选集**跑一次打分，返回 `chosen / score / factors / rejected / candidates`。
不调用真实模型、不落库，用于在改权重前确认结果。`weights` / `strategy` 不传则用已保存配置。

---

## 16. 全局搜索

### GET `/search?q=&limit=5`

一次查五类对象，返回结果按类型分组，**每项自带前端跳转路由**（前端只渲染，不重复维护路由规则）：

```json
{
  "query": "订单",
  "total": 7,
  "groups": [
    { "kind": "task", "label": "任务",
      "items": [{ "id": "1bc9b1a7…", "title": "订单延迟异常闭环 12:29:11",
                  "subtitle": "成功", "route": "/tasks/1bc9b1a7…" }] },
    { "kind": "skill", "label": "技能", "items": [ … ] },
    { "kind": "workflow", "label": "工作流", "items": [ … ] }
  ]
}
```

- 匹配字段：任务（标题/编号）、运行（编号/trace_id）、智能体（名称/编码）、技能（名称/编码）、工作流（名称/编码）；
- `q` 长度 1–60，`limit` 每组条数（1–20，默认 5）；
- 前端 `Ctrl/Cmd + K` 调用该接口，180ms 防抖，`↑↓` 选择、`Enter` 跳转、`Esc` 关闭。

---

## 17. 工作台外壳（快照与问答）

给 `agentmatrix-workbench/外壳/` 用。场景配置在 `外壳/scenarios/*.json`，场景记忆在 `引擎数据/.dsh/场景记忆/`，都存在**外壳的文件**里，平台不落库；
平台只负责两件事：给快照、给结论。

> 2026-11-24 起工作台界面**只剩 DSH 会话**这一条 AI 入口：四个场景的「场景助手」（`am-assistant`）面板已删除，
> 下方两个接口因此不再被界面调用，但**保留可用**（脚本、回归、以后要恢复面板时仍用它），审计照记。

### GET `/workbench/context`（operator / developer）

一次拿到外壳 KPI 面板需要的全部数字：

```json
{
  "tasks": { "succeeded": 52, "failed": 1, "waiting_approval": 1 },
  "runs_24h": { "succeeded": 52, "waiting_approval": 1, "failed": 1 },
  "pending_approvals": 1,
  "pending_dead_letters": 1,
  "matrix": { "coverage": 0.8125, "covered_cells": 26, "total_cells": 32, "gap_count": 6,
              "gaps": ["需求计划 × 感知与解析", "…"] },
  "dispatch": { "strategy": "s4_llm_planner", "source": "db" },
  "recent_failures": [{ "run_id": "acd8ba3d", "error_code": "BUSINESS" }]
}
```

### POST `/workbench/ask`（operator / developer）

```json
{ "scenario": "delivery", "scenario_name": "交付追踪",
  "memory": "# 交接\n上次处理完 E2E 验证…", "question": "这个场景现在最该做什么？",
  "use_mock": false }
```

返回 `answer / provider / model / tokens / cost_usd / duration_ms / snapshot`；
`use_mock=true` 走离线确定性模型。

设计约束：**提示词里明确要求只用给定的快照与记忆**，快照里没有的必须回答"没有"——
助手报告的"51 个成功、1 个待审批"必须与数据库一致，数字不由模型自行统计。
每次提问写审计（`workbench.ask`，含场景、问题摘要、Token 与成本）。

---

## 18. 调用示例

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

## 19. 已知限制

1. 多数列表只有 `limit`（订单、任务与审计另有 `offset`），没有游标或页码——演示规模够用，数据量大时需补 `cursor`。
2. 工作流有 `GET /workflows/{code}/diff`；智能体与技能没有版本对比接口，只能分别取两个版本自行比较。
3. 告警渠道只有站内，`channel` 字段已预留但未实现 webhook 外发。
4. 产物内容存库，单文件体积不宜过大。
5. 审计日志只追加、无归档策略；长期运行需要另做分区或转储。
6. 技能没有独立的版本表：版本号在 `skills.version`，历史配置在审计记录里。
