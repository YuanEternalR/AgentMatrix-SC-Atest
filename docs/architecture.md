# 系统架构

> 最后更新：2026-11-23
> 本文件对应论文第四章。所有描述与仓库代码一致；未实现的部分均明确标注。

## 1. 设计目标与约束

| 目标 | 约束 |
|---|---|
| 本地可运行、可演示、可复现 | LLM 可切 Mock / DeepSeek；业务数据为真实 DataCo 订单，Mock 模式不依赖任何外部 Key |
| 工单/任务可追溯到步骤级 | 运行锁定工作流与智能体版本，版本不可变 |
| 调度策略可插拔、可对比 | 策略是注册表里的实现，配置切换即可，不改业务代码 |
| 单人毕业设计周期内能交付 | 技术选型优先"少一个中间件"，能力不足处明确标注 |

## 2. 五层架构

```
┌──────────────────────────────────────────────────────────┐
│ 前端交互层  React 18 + Vite + TypeScript                  │
│ 工作台 / 矩阵 / 工作流设计器 / 运行详情 / 仪表盘 / 告警     │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTP JSON（Bearer JWT）
┌───────────────────────────▼──────────────────────────────┐
│ 业务应用层  FastAPI（同步端点 + 线程池）                    │
│ 任务 / 运行 / 审批 / 产物 / 矩阵 / 指标 / 告警 / 工作流      │
└───────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────┐
│ 智能体矩阵调度层                                           │
│  三级决策：硬过滤 → 策略评分/规划 → 落库可解释拆解            │
│  执行器：状态机 + 游标恢复 + 重试退避 + 审批暂停             │
└───────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────┐
│ 数据中台层  PostgreSQL 16（状态与审计）+ Redis 7（预留）     │
└───────────────────────────┬──────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────┐
│ 基础设施层  WSL2 + Docker Engine / Compose（5 个容器）       │
└──────────────────────────────────────────────────────────┘
```

### 层间接口

| 边界 | 协议 | 说明 |
|---|---|---|
| 前端 ↔ API | JSON over HTTP，`/api/v1/*` | 统一 `application/json; charset=utf-8` |
| API ↔ 数据库 | SQLAlchemy 2.0 + psycopg3 | 同步驱动，API、Worker、Alembic 共用 |
| API ↔ Worker | **数据库**（`runs.status` + `next_attempt_at`） | 不引入消息中间件 |
| Worker ↔ LLM | `LLMGateway` 接口 | Mock 与 DeepSeek 两个 Provider，由 `LLM_PROVIDER` 切换 |
| Worker ↔ 业务系统 | skill 注册表（内置函数） | HTTP/SQL/MCP 技能留作扩展 |

## 3. 调度层设计（研究点）

### 3.1 三级决策

```
候选池 ──硬过滤──▶ 可行集 ──策略──▶ 决策 ──▶ 可解释拆解（落库）
```

1. **硬过滤**（`services/dispatch/filtering.py`）
   能力标签、阶段、并发上限、p95 超过 SLA、单步成本超过预算——任一不满足即淘汰，并记录原因。
   **任何策略都不能越过这一层**，包括大模型规划器。
2. **策略**（`services/dispatch/strategies.py`）
   五种实现，见下表。
3. **可解释**（`dispatch_decisions` 表）
   每个因子给出 `raw / weight / contribution / detail`，前端据此画出条形图。

### 3.2 五种策略

| 编号 | 名称 | 规则 | 定位 |
|---|---|---|---|
| S0 | 全大模型 | 固定走大模型智能体 | 质量上限基线 |
| S1 | 固定规则 | 注册顺序取第一个可用 | 下界基线 |
| S2 | 加权打分 | 能力35/成功率20/负载15/成本10/时延10/亲和10 | 产品基线 |
| S3 | SLA 成本优先 | 质量下限 + SLA 余量后取最低成本 | 成本优化上界 |
| S4 | 大模型规划 + 规则校验 | LLM 提候选，规则校验其必须在可行集内，否则回退 S2 | **本方案** |

S4 的关键：规划器**无权绕过硬过滤**，只能"在安全集合里挑"。这既保留 LLM 对复杂语义的判断力，又避免幻觉把任务派给不合格执行者。

### 3.3 执行模型

运行状态机：

```
queued ──▶ running ──┬──▶ waiting_approval ──(批准)──▶ queued ──▶ running
                     ├──▶ queued ──(可重试失败，退避到 next_attempt_at 后重领；步骤记 retrying)
                     ├──▶ succeeded
                     ├──▶ failed ──▶ dead_letter
                     └──▶ canceled / timed_out
```

- **游标恢复**：`runs.cursor_node_id` + `runs.context` 每节点落库，进程重启后从断点继续。
- **重试**：只对 `TRANSIENT / RATE_LIMIT / UPSTREAM / TIMEOUT` 重试；退避为指数 + ±20% 抖动，通过 `runs.next_attempt_at` 调度，不阻塞 Worker。
- **死信**：重试耗尽与失败状态在**同一次事务**提交，避免"已失败但无死信"的中间态。
- **审批**：唯一暂停点，创建 `approvals` 记录后释放执行权；决策回写步骤状态与审批人。
- **条件**：受限语法（比较 / `in` / 空值判断），**不使用 `eval`**。

## 4. 关键设计决策

| 决策 | 选择 | 理由 | 代价 |
|---|---|---|---|
| 队列实现 | PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`，不用 Celery | 运行状态本就在库里，消息队列会造出"两份真相"；崩溃后自动可领取 | 没有 Celery 的生态（beat/monitor），需自己写轮询 |
| 数据库驱动 | 同步 SQLAlchemy + psycopg3 | API、Worker、Alembic 共用一套；async 在这个量级收益小 | 高并发下线程池是瓶颈 |
| 版本模型 | 已发布版本不可变，改图=新建版本 | 运行可复现的前提 | 版本数量增长，需要归档策略 |
| LLM 网关 | Mock 与 DeepSeek 双 Provider | 离线演示用 Mock；接真实模型后成本/时延均为真实计量 | 真实模型有波动与超时，需依赖重试 |
| 图表 | ECharts 按需注册 + `React.lazy` 拆包 | 主包 235.4 kB（gzip 75.0 kB），图表包 592.3 kB（gzip 201.2 kB）按需加载（2026-11-23 `apps/web/dist` 构建产物实测） | 首次进仪表盘多一次请求 |
| 产物存储 | 内容直接入库（`artifacts.content`） | 演示级体积，省掉 MinIO | 大文件不可行，需改对象存储 |

## 5. 数据模型（19 张表 + 11 个 Alembic 迁移）

业务表共 19 张（含 `users`、`system_settings`）；另有 Alembic 的 `alembic_version` 迁移表，迁移文件 11 个（`apps/api/alembic/versions/`）。

| 分组 | 表 | 作用 |
|---|---|---|
| 组织 | `users` | 账号 + 角色（admin/developer/operator/viewer） |
| 智能体 | `agents`、`agent_versions` | 能力标签、路由统计量；版本不可变，发布即归档旧版 |
| 技能 | `skills`、`skill_runs` | 技能注册（内置/HTTP）与每次执行记录（平均耗时/成功率的数据源） |
| 工作流 | `workflows`、`workflow_versions` | 图定义（JSONB），版本不可变 |
| 任务 | `tasks` | 业务请求，含幂等键、复杂度提示 |
| 运行 | `runs`、`run_steps` | 运行态、游标、上下文；步骤级审计（含 attempt） |
| 调度 | `dispatch_decisions` | 决策因子拆解 + 淘汰原因 |
| 人工 | `approvals` | 待办与决策留痕 |
| 容错 | `dead_letters` | 重试耗尽后的人工入口 |
| 产物 | `artifacts` | 报告内容与元信息 |
| 观测 | `alert_rules`、`alert_events` | 指标阈值与事件状态 |
| 合规 | `audit_logs` | 只追加的操作审计：操作者快照、动作、对象、变更前后、IP/UA |
| 业务 | `supply_orders` | 真实订单事实表（DataCo 65,752 单），业务看板与履约诊断的数据源 |
| 配置 | `system_settings` | 运行时配置：调度策略与权重（界面可改、即时生效、变更进审计） |
| 迁移 | `alembic_version` | Alembic 版本表 |

### 索引与约束要点

- `tasks.idempotency_key` 唯一：同一幂等键不会重复建任务。
- `(agent_id, version)`、`(workflow_id, version)` 唯一：版本号不可重复。
- `runs.status`、`tasks.status`、`dead_letters.status`、`alert_events.status` 均建索引：列表页与 Worker 领取是高频查询。
- 外键 `ondelete=CASCADE` 只用在"父 → 子"的从属关系（任务 → 运行、运行 → 步骤/审批/产物/死信、
  智能体 → 版本、技能 → 执行记录、工作流 → 版本、告警规则 → 事件），避免误删业务主数据。
- `audit_logs` 上装了两个 BEFORE 触发器（`trg_audit_logs_no_update` / `no_delete`），
  配合 `audit_logs_append_only()` 函数在数据库层拒绝改与删。**审计不挂任务外键**：
  `resource_id` 是字符串，任务被重置或删除后审计仍然成立——这是审计需要的行为。

### 审计写入点（代码可写 20 类动作）

| 模块 | 动作编码 | 记什么 |
|---|---|---|
| 登录 | `auth.login` / `auth.login_failed` | 成功与失败都记；失败记录的是"尝试者填的邮箱"（已脱敏），不是查到的用户 |
| 任务 | `task.create` | 标题、工作流、优先级、业务参数 |
| 工作流 | `workflow.publish` | 新版本号、变更说明、节点数；`before` 记上一版号 |
| 审批 | `approval.decide` | 谁批的、通过/驳回、意见、运行状态变化 |
| 死信 | `dead_letter.retry` / `ignore` | 运行、节点、错误分类（已翻中文） |
| 告警规则 | `alert_rule.create` / `update` / `delete` | 只记改动字段的前后值，两侧字段集合一致 |
| 告警事件 | `alert.ack` / `resolve` | 事件内容、当前值与阈值 |
| 技能 | `skill.create` / `version` / `delete` | 配置快照（脱敏后）与版本号；技能详情页的"版本历史"读取这些记录 |
| 智能体 | `agent.create` / `update` / `publish` | 新版本号、绑定技能、提示词长度 |
| 调度配置 | `dispatch.configure` | 改前/改后的策略与权重——影响全局的动作必须能查是谁改的 |
| 工作台 | `workbench.ask` | 场景、问题摘要、Token 与成本（场景助手每次提问都记） |

> 编码表见 `apps/api/app/services/redaction.py` 的 `ACTION_LABELS`（20 类）；截至 2026-11-23 21:04，
> 演示库 `audit_logs` 里实际出现过其中 13 类，其余是接口已支持但本库尚未被触发的动作。

### 技能执行语义（`services/skill_runtime.py`）

| 类型 | 行为 |
|---|---|
| `builtin` | 从 `REGISTRY` 取 Python 函数执行；入参即函数入参 |
| `http` | **默认 Mock**：不联网，响应由 `mock_response` 模板或输入哈希决定；关掉 Mock 后走真实请求，先过 SSRF 防护（拒绝回环/内网/链路本地/保留地址，多 A 记录任一命中即拒），域名白名单是唯一例外 |
| `sql` / `mcp` | 未实现，接口返回 422 并说明原因 |

执行必然留痕：`skill_runs` 记 `ok / duration_ms / source(test|workflow) / input 摘要 / error_code`，
失败也记（成功率要有分母）。技能列表的「平均耗时 / 成功率」由它聚合，没测过的技能返回 `null` 而不是 0。

### 调度策略的运行时配置（`services/settings_store.py`）

| 关注点 | 做法 | 原因 |
|---|---|---|
| 配置来源 | 库里有 `system_settings.dispatch` 就用它，否则回落 `.env`；响应带 `source: env\|db` | 部署配置仍是默认值，但不必为了改策略重启 |
| 生效时机 | `dispatcher.make_strategy(db)` 每次调度读一次（主键查询） | Worker 不用重启，改完下一次任务就用新参数 |
| 合法性 | 保存前校验：策略名、权重非负且总和 > 0、SLA 余量 ∈ (0,1]、质量下限 ∈ [0,1] | 不拦就会把错误配置带到线上，且报错延迟到下一次调度 |
| 可设计性 | `POST /settings/dispatch/preview` 用真实候选集跑一次打分（固定规划器，不调模型、不落库） | 权重可配置的意义在于修改后即可确认选中结果 |
| 可追溯 | 每次保存写 `dispatch.configure`（改前/改后） | 策略变更是影响全局的动作，必须能查是谁改的 |

## 6. 接口清单（52 条路径 / 60 个操作）

| 模块 | 端点 |
|---|---|
| 鉴权 | `POST /auth/login`、`GET /auth/me` |
| 任务 | `POST /tasks`、`GET /tasks`、`GET /tasks/{id}` |
| 运行 | `GET /runs`、`GET /runs/{id}`、`POST /runs/{id}/cancel` |
| 审批 | `GET /approvals`、`POST /approvals/{id}/decision` |
| 智能体 | `GET /agents`、`GET /agents/{code}`、`POST /agents`、`PATCH /agents/{code}`、`POST /agents/{code}/versions`、`POST /agents/{code}/test` |
| 技能 | `GET /skills`、`GET /skills/{code}`、`GET /skills/registry`、`POST /skills`、`POST /skills/{code}/versions`、`POST /skills/{code}/test`、`DELETE /skills/{code}` |
| 工作流 | `GET /workflows`、`GET /workflows/{code}`、`GET /workflows/{code}/diff`、`POST /workflows/{code}/validate`、`POST /workflows/{code}/versions` |
| 订单 | `GET /orders`、`GET /orders/stats`、`GET /orders/{id}` |
| 矩阵 | GET /matrix |
| 可视化 | `GET /graphs/collaboration`、`GET /graphs/sankey`、`GET /business` |
| 观测 | `GET /metrics`、`GET/POST /alert-rules`、`PATCH/DELETE /alert-rules/{id}`、`POST /alert-rules/evaluate`、`GET /alert-events`、`POST /alert-events/{id}/ack|resolve` |
| 容错 | `GET /dead-letters`、`POST /dead-letters/{id}/retry|ignore` |
| 产物 | `GET /artifacts`、`GET /artifacts/{id}/download` |
| 审计 | `GET /audit-logs`、`GET /audit-logs/summary`、`GET /audit-logs/export.csv`（无写接口） |
| 设置 | `GET/PUT /settings/dispatch`、`POST /settings/dispatch/preview` |
| 搜索 | `GET /search?q=`（任务/运行/智能体/技能/工作流，结果自带跳转路由） |
| 工作台外壳 | `GET /workbench/context`（实时快照）、`POST /workbench/ask`（场景记忆 + 快照 → 模型结论） |
| 运维 | `GET /health`、`GET /meta` |

> 口径：52 条路径 / 60 个操作，含根路径 `GET /health` 与 `GET /api/v1/meta`；可用 `curl http://127.0.0.1:8000/openapi.json` 核对。

交互式文档：`http://127.0.0.1:8000/docs`。

## 7. 部署拓扑与当前状态

```
Windows 11
└─ WSL2 发行版 Ubuntu-AgentMatrix
   └─ Docker Engine
      ├─ agentmatrix-sc-postgres-1   127.0.0.1:5433 → 5432   （命名卷 pgdata）
      ├─ agentmatrix-sc-redis-1      127.0.0.1:6380 → 6379   （命名卷 redisdata）
      ├─ agentmatrix-sc-api-1        127.0.0.1:8000 → 8000   （源码 bind mount）
      ├─ agentmatrix-sc-worker-1     不映射宿主端口（容器内 8000）   （同一镜像，命令不同）
      └─ agentmatrix-sc-web-1        127.0.0.1:5173 → 5173   （node:22 + 命名卷 node_modules）
```

- 所有端口只绑 `127.0.0.1`，不暴露到局域网。
- `web` 用命名卷缓存 `node_modules`，避免在 Windows 盘（WSL 里的 `/mnt/<盘符>/…`）上读写数万小文件。
- **常驻会话**：WSL 在最后一个会话退出时会清理发行版内进程，导致 `dockerd` 被 systemd 重启、容器跟着重启。`dev up` 会额外拉起一个隐藏的常驻会话解决该问题。

### 7.1 当前状态（2026-11-23 本机实测）

| 项 | 状态 |
|---|---|
| 容器 | api / worker / web / postgres / redis 共 5 个都在运行；api、postgres、redis 有 healthcheck（healthy），web、worker 无 healthcheck（`Up` 即正常）；前端 `http://127.0.0.1:5173`，接口 `http://127.0.0.1:8000` |
| 接口 | OpenAPI **52 条路径 / 60 个操作**（含 `GET /health`、`GET /api/v1/meta`） |
| 数据模型 | 19 张表（含 `users`、`system_settings`）；Alembic 11 个迁移文件 |
| 真实订单 | DataCo 65,752 单；准时率（`otif_rate` 字段：`Shipping on time / 总单` = 11,722/65,752）17.83%，延迟率 54.82%，平均延迟 0.567 天。**严格 OTIF 的 in-full 未计算**（数据集只有发货状态，口径见 data-sources.md） |
| 矩阵 | 8 阶段 × 4 能力 = 32 格，覆盖 26 格（81.25%），6 个缺口；工作流 4 条 |
| 种子数据 | 智能体 15 个、技能 15 个（当前演示库各 34 个，含界面/测试新建的） |
| 运行 | 累计 54 次（成功 52 / 失败 1 / 待审批 1），成功率 98.11%，成本 $0.0170，token 25,145 |
| 审计与告警 | 审计 815 条（2026-11-23 21:00 基线；之后每次登录/操作都在涨——21:09 实测 830，以 `GET /audit-logs/summary` 的 `total` 为准）；待审批 1；死信 3（待处理 1，已重试 2）；告警规则 4 条、未关闭事件 2 条 |
| 工作台 | 5 个场景 / 21 个面板（16 个原生渲染器 + 5 个「DSH 会话」webview，每场景一个；原生类型 18 种注册、16 种在用）；AI 问答只走「DSH 会话」；启动时自动拉起平台与 DSH 引擎 |
| DSH 引擎 | `@deepseek-ai/dsh` 0.2.2-rc.5，profile=`workbench`，`DSH_HOME=agentmatrix-workbench/引擎/.dsh`，端口 3083 |
| 版本 | Electron 43.4.0；工作台 0.2.1-rc.3；Node 24.20.0；容器 Python 3.11.18 |

### 7.2 测试（2026-11-23 本机实测）

| 测试 | 规模 |
|---|---|
| 单元测试 | 宿主机 102 条；容器内 128 条 |
| 业务 E2E | 17 步 |
| 路由冒烟 | 18 个页面 |
| 工作台回归 | 19 步（5 个场景步 + 14 个功能步） |

## 8. 与提示词技术栈的偏差

| 提示词要求 | 实际做法 | 原因 |
|---|---|---|
| Redis 队列 + Celery | 数据库队列 + Worker 轮询 | 状态单一真相源；少一个中间件 |
| Docker Compose 一键启动 | 已实现，但运行在 WSL2 Docker Engine，非 Docker Desktop | `desktop.docker.com` 在本机网络不可达 |
| PostgreSQL 16 / Redis 7 | 一致 | — |
| ECharts | 一致（按需注册） | — |
| Playwright E2E | 用 playwright-core + 系统 Edge | 本网络下载 Chromium 不可靠 |
| 五类可视化 | 五类均已实现：矩阵、DAG、协作拓扑、桑基图、业务看板 | — |
| 代码类技能沙箱 | 未实现（仅内置函数） | MVP 明确后置 |

## 9. 已知局限

1. **策略对比是仿真、执行是真实**：产品执行已接 DeepSeek（真实 token 与成本）；但五种策略的对比实验仍在仿真器里跑（控制变量），论文中标为"仿真数据"。
2. **路由统计量是种子设定**：`agents.success_rate / avg_cost_usd` 尚未由 `run_steps` 滚动聚合刷新（设计已预留字段）。
3. **并发能力已有实测，但有边界**：50 并发端到端 P95 1.83s（2 Worker），100 并发时受智能体并发上限与 5 秒重分配周期影响退化为两批次。详见 [experiments/load-test.md](experiments/load-test.md)。这是 Mock 环境下的引擎能力，不等于生产容量。
4. **无多租户**：按提示词约定不做，所有查询不带租户过滤。
5. **告警仅站内**：`channel` 字段预留 webhook，未实现外发。
6. **审计覆盖 20 类动作，但没有"改派"与"密钥操作"**：系统没有改派接口，也没做密钥管理。
   审计只追加、不可改删，但**保留策略**未做——`audit_logs` 只增不减，长期运行需另外设计归档。
7. **在线测试与引擎执行都是单轮**：一次技能收集 + 一次模型结论。多轮工具循环会引入
   循环终止与预算控制的语义，本课题不做。
8. **技能版本没有独立的 `skill_versions` 表**：版本号在 `skills.version` 上递增，
   旧配置以脱敏快照存进审计记录，详情页的"版本历史"读审计。代价是版本对比不如智能体方便。

## 10. 代码位置索引

| 关注点 | 路径 |
|---|---|
| 调度策略 | `apps/api/app/services/dispatch/` |
| 执行器 | `apps/api/app/services/engine.py` |
| 重试与错误分类 | `apps/api/app/services/errors.py` |
| Worker | `apps/api/app/worker/main.py` |
| 图校验 | `apps/api/app/services/graph_validation.py` |
| 指标聚合 | `apps/api/app/services/metrics.py` |
| 告警评估 | `apps/api/app/services/alerts.py` |
| 审计写入与上下文 | `apps/api/app/services/audit.py` |
| 脱敏与用词表 | `apps/api/app/services/redaction.py` |
| 审计接口 | `apps/api/app/api/routes/audit.py` |
| 技能执行分派 | `apps/api/app/services/skill_runtime.py` |
| HTTP 技能（SSRF/Mock/请求） | `apps/api/app/services/http_skill.py` |
| 技能与智能体接口 | `apps/api/app/api/routes/skills.py`、`routes/agents.py` |
| 调度配置（读写/校验） | `apps/api/app/services/settings_store.py`、`routes/settings_api.py` |
| 设计指南（页面） | `apps/web/src/pages/Guide.tsx`、`docs/design-guide.md` |
| 全局搜索 | `apps/api/app/api/routes/search.py`、`apps/web/src/components/CommandPalette.tsx` |
| 工作台外壳 | `agentmatrix-workbench/`（场景 JSON / 记忆 / 面板注册表）、`apps/api/app/api/routes/workbench.py` |
| 交互反馈组件 | `apps/web/src/components/Toast.tsx`、`Confirm.tsx`、`Skeleton.tsx` |
| 前端页面 | `apps/web/src/pages/` |
| 图表导出 | `apps/web/src/lib/chartExport.ts`、`apps/web/src/components/EChartCard.tsx` |
| 数据库迁移 | `apps/api/alembic/versions/` |
| 测试 | `tests/unit/`、`tests/e2e/`、`scripts/*-test.ps1`、`scripts/check-*.ps1` |
