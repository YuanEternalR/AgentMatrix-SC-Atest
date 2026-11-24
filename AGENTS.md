# AGENTS.md · AgentMatrix-SC 新会话开工须知

> 本文件由 DSH 的 `agent-instructions` 自动加载到每个新会话（2026-11-23 起启用），
> 用于让新会话在不额外交代背景的情况下接上项目进度。
> 新会话按 §1 的顺序执行，再开始修改。

## 0. 任务拆分与子 Agent 协作

默认先拆分任务，再决定并行与分配；拆分收益应大于协调成本。

1. **先拆后做**：接到任务先列子任务与依赖；有至少 2 个边界清晰、可独立验收的子任务时，
   并行派给子 Agent（`subagent` / `subagent_fork`，大批量用 `workflow`）；单点小任务直接处理，不强行拆分。
2. **分配时给全上下文**：目标、输入路径、约束、验收标准、回报格式一次写清；子 Agent 不共享本会话记忆，
   不能依赖其自行推断。涉及最新数据时，把查询方式或快照一并给出。
3. **划定边界**：子 Agent 只改约定的文件或目录；跨模块判断、共享文件、最终集成与统一口径由主 Agent 负责。
   多个子 Agent 不同时修改同一文件。
4. **复核结果**：子 Agent 的结论不直接采信，需读 diff、运行相关验证、抽查关键数字与口径；
   发现偏离时发消息纠正、重派或终止。
5. **主 Agent 收口**：统一命名与数字口径、同步文档、决定最终交付，避免多个子 Agent 产出相互矛盾。
6. **记录过程**：在回复中说明拆分了什么、派给谁、各自结果与验证结论；失败或超时需明确记录。
7. **避免形式化拆分**：一次能完成的任务不拆分；并行只在节省时间、隔离上下文或多角度复核确有收益时使用。
8. **安全**：子 Agent 同样遵守 §4 的编码、数据与文档纪律；删库、重置数据、修改密钥等操作
   只能由主 Agent 在明确授权下执行。

### 0.1 调试类任务的分工

以「淡入淡出 + 启动闪帧」为例：

- **不拆分的情况**：根因未明、必须在同一实例反复测量、改动集中在同一组文件
  （如 `renderer.js` / `styles.css` / `customer-start.js` / `preload.js` / `index.html`）。
  并行会相互干扰，子 Agent 也拿不到主 Agent 的实时采样数据，应由主 Agent 直接处理。
- **根因确认后可以并行的**（与核心修复同时进行）：
  - 文档同步：README / HANDOFF / workbench-template 对应轮次 / 进度报告；
  - 验证夹具：如延迟 `__bootFinish` 模拟慢启动、无头回归脚本；
  - 数据核对：调 API 取快照、核对历史实验数字与文档口径。
- **硬约束**：
  - 主 Agent 与子 Agent 不同时修改同一文件；子 Agent 只处理约定文件或目录；
  - 不并行操作同一个运行中的工作台或引擎实例（热重载、重启、改数据会产生竞态）；
  - 子 Agent 的产出必须复核 diff、运行相关验证、抽查关键数字后才并入，口径由主 Agent 统一。
- **记录**：回复中写明本次拆分内容、未拆分的内容与原因、子 Agent 的结果和验证结论。
- 判断原则：先确认能否并行、是否存在共享状态。共享状态越少、验收越独立，越适合拆分；
  共享状态只有一份（同一实例或同一文件）时，串行执行更合适。

### 0.2 根本准则：省 Token + 提效率（2026-11-23 用户要求）

> 与"把事做对"同级：默认用更少的上下文/调用达到同样的正确性；省 token 不省验证与数据真实性。

1. **先估预算**：开工前判断要读哪些文件、跑哪些命令、能否一次脚本/子 Agent 完成；禁止"先全量通读再说"。
   工具优先 grep/glob 精确定位，read 带 offset/limit，长输出只看尾部/摘要，命令能合并就合并。
2. **01 新开对话 / 02 少压缩上下文**：独立的新任务优先新会话（AGENTS.md + HANDOFF 能接上进度）；
   控制单会话体积——不贴长文、不重复读同一文件、不复述已知信息；接近上下文上限时先更新 HANDOFF
   再新开对话，不要硬撑到自动压缩丢细节。
3. **03 清理 Skills / 05 省 Token 插件**：只保留当前任务用得上的技能与插件；可信的压缩/缓存/裁剪类
   省 token 插件优先使用；来源不明的插件先说明收益与风险，不擅自安装。
4. **04 PTC 模式**：工具或客户端支持 PTC（提示缓存/复用类模式）时优先启用；先确认其语义与副作用，
   不为省 token 改变结论正确性。
5. **06 子智能体**：读大量材料、多文件排查、多角度复核这类上下文重的独立工作派给子 Agent，
   主 Agent 只收结论、保住主上下文；分工与复核仍按 §0/§0.1 执行。
6. **07 错峰使用 / 08 便宜模型低档位**：批量实验、报告生成、大规模回归尽量放低峰时段，利用价格折扣；
   例行查询、格式化、简单改动用便宜模型或低 reasoning，只有根因分析、架构设计、复杂调试才升级，
   并在回复里说明升级理由。
7. **输出与执行也省**：先结论后证据，能一句话说清不写三句；独立工具调用并行、不空转轮询；
   文档只改必要段落，不整篇重写；批量任务记录 token/成本，供下次估算。
8. **省 token 不省正确性**：关键文件必读、测试必跑、数字可复现；省掉的是冗余上下文与重复劳动，
   不是验证环节。

### 0.3 记忆准则（2026-11-24 用户定，常驻；细则见 `agentmatrix-workbench\说明\记忆约定.md`）

> 今后所有对话都按这套准则维护记忆；互斥的准则**交用户裁决**，不自行改判。

1. **双轨**：项目级 = 本文件 + `docs/HANDOFF.md`（平台/接口/数据基线、测试、编码纪律）；
   场景级 = `agentmatrix-workbench\引擎数据\.dsh\场景记忆\<场景>\场景私有记忆.md`（面板、交互、口径、场景坑）。
   两层各留一行指针，不复制正文。
2. **场景记忆格式**：`§〇` 五小节（1 上次交接 / 2 当前项目 / 3 私有记忆变更 / 4 下一步·卡点 / 5 全貌）且 ≤4 KB；
   `## 核心职责` ≥3 条；`§一~§五` 只追加。`身份卡.md`/`场景画像.md` 是工具产物，⛔ 不手改。
3. **工具为准**：`node agentmatrix-workbench\工具\场景记忆.mjs list|init|stamp|交接|check`（`check --all` 全场景）；
   跨场景 `发消息.mjs`（纯文件）；出包前 `发布前检查.mjs`。文档与工具冲突时以 `check` 实测为准并回写说明。
4. **索引 7 列**：`外壳\scenarios\_场景身份索引.md` 必须恰好 7 列（场景 id/面板 id/标题/会话/会话 id/定位卡/技能）；
   改卡或改场景 json 后跑 `stamp`，否则指纹过期。
5. **交接**：一轮结束先 `交接 --场景 <名字>` 归档旧版并补 §〇，再 `check`；check 不过不换会话。
6. **压缩**：准则可压缩——同一句话只写一处、细节下沉到 §五/归档/项目记忆、文档只改必要段落。

## 1. 开工流程

1. **读交接（双轨）**：项目级读 `docs/HANDOFF.md`（现状、规模、约束、边界、下一步）；
   场景级先跑 `node agentmatrix-workbench\工具\场景记忆.mjs check --all`，再读目标场景 `场景私有记忆.md` 的 §〇；
2. **查看仓库状态**：`git status --short` 与 `git log --oneline -8`，确认是否有未提交改动、最近做了什么；
3. **按任务读专题文档**：
   - 平台、接口、数据 → `docs/architecture.md`、`docs/api.md`、`docs/requirements-audit.md`
   - 工作台、场景、面板 → `docs/workbench-template.md`（§26 为最新一轮）、`agentmatrix-workbench/README.md`
   - DSH 接入、插件 → `docs/dsh-integration.md`
   - 数据、实验 → `docs/data-sources.md`、`docs/experiments/*`（历史实验数字不得修改）
4. **需要活数据时查询**（不凭记忆、不手填）：`dev health`、`GET /api/v1/metrics`、`/matrix`、`/orders/stats`
   （登录：`POST /api/v1/auth/login`，账号见 §5）；
5. 无法核实的项标注「未验证」，不做推测。

## 2. 项目概述

- **供应链智能体矩阵平台**（毕业设计）：真实 DataCo 订单、真实 DeepSeek 模型、5 种调度策略，
  以及审批、审计、可观测与四条业务闭环。系统是主体，调度策略是研究重点。
- **桌面工作台** `agentmatrix-workbench/`：Electron，5 个场景 / 21 个面板
  = 16 个原生渲染器 + 5 个「DSH 会话」webview（每场景一个，各绑本场景专属会话；场景内单会话、不显示全局侧栏，AI 问答只走它）；启动时自动拉起平台（`dev.cmd up`）与 DSH 引擎（端口 3083）。
- **平台**：FastAPI（8000）+ React 18/Vite（5173）+ Postgres 16/Redis 7，docker compose 运行在 WSL2 `Ubuntu-AgentMatrix`。

## 3. 当前基线（2026-11-23 22:20 实测；数字会增长，以活数据为准）

| 项 | 值 |
|---|---|
| 接口 | 52 条路径 / 60 个操作（`/openapi.json`） |
| 数据模型 | 19 张表 / 11 个 Alembic 迁移 |
| 数据 | DataCo 65,752 单；准时率 17.83%（`otif_rate`，按 Delivery Status；严格 OTIF 的 IF 未算）、延迟率 54.82%、平均延迟 0.567 天 |
| 矩阵 | 8×4=32 格，覆盖 26 格（81.25%），6 缺口；4 条工作流；种子智能体/技能各 15（演示库各 34） |
| 运行 | 54 次：成功 52 / 失败 1 / 待审批 1，98.11%，$0.0170，25,145 token |
| 审计 | 20 类动作（代码映射）；dead letters 3、告警规则 4、未关闭告警 2 |
| 测试 | 单测 102（宿主机）/128（容器）；业务 E2E 17 步；路由冒烟 18 页；工作台回归 19 步 |
| 工作台 | 5 场景 21 面板（16 原生 + 5 个「DSH 会话」webview，各绑 `场景 · <场景名>` 专属会话）；DSH 引擎 0.2.2-rc.5（profile `workbench`，`DSH_HOME=引擎/.dsh`，端口 3083） |
| 最近变更 | 2026-11-24 晚（第二十二轮）：五个场景各绑定自己的「场景 · <场景名>」专属 DSH 会话，场景面板改单会话模式（隐藏全局侧栏、修侧栏按钮错位），新增 `工具/场景会话.mjs`；`场景会话.mjs check` 5/5、工作台回归 19/19。2026-11-24：按反馈删除四个场景的「场景助手」（`am-assistant`）面板，25→21 面板（16 原生 + 5 DSH 会话），渲染器与 `/workbench/ask` 接口保留；布局脚本 `scripts/layout-full.cjs` 改为当前基线；`场景记忆.mjs check --all` 5/5、工作台回归 19/19；2026-11-24：每个场景新增「DSH 会话」面板（21→25 面板），`panelPartition` 改为一板一分区（不再依赖 json 的 sessionId），`sessions.mjs --check` 与 `场景记忆.mjs check` 同步放宽；启动卡 92% 根因修复：引擎"就绪"改为等 token 到手（`waitForToken` + `signalHarnessReady` 补发），渲染层未就绪不再放弃、兜底绝不进无 token 白页（2026-11-23，见 `docs/workbench-template.md` §23 / HANDOFF 约束 #19）；工作流设计器：点节点打开右侧编辑器、可改「下一步连到」；DSH 面板三轨道布局修复；平台随工作台自启动；删除总览「DSH 大脑」；矩阵履约交付系数对齐 68 部门；场景切换遮罩与加载页闪帧修复；DSH 引擎页分层常驻 + 双向淡入淡出（不再重载） |

## 4. 工作纪律

- **文档同步**：修改代码后同步文档，至少更新 `docs/HANDOFF.md` 的「当前规模 / 已知边界 / 已完成验证」；
  工作台相关再更新 `docs/workbench-template.md` 对应轮次。文档中的数字必须是可复现的实测值。
- **验证**：
  - `python -m pytest -q`（宿主机 102 条；容器内 128 条）
  - 修改前端页面：`node tests/e2e/routes.mjs`（18 页，防白屏）
  - 修改工作台：`node tests/e2e/workbench.mjs`（19 步；工作台运行时用 `WB_SHELL_DIR=agentmatrix-workbench/外壳-test` 指向隔离副本）
- **编码**：UTF-8 无 BOM；`.cmd/.bat/.vbs` 纯 ASCII；`.ps1` 带 BOM；`.md/.json/.js/.py` 不带 BOM。
- **数据**：所有运行、测试、覆盖率数字都要能从 API 或脚本复现；历史实验（`docs/experiments/*`）只加时点说明，不改测量值。
- **工作台约定**：
  - 面板优先使用原生渲染器（`APP_RENDERERS['am-*']`）；webview 只允许 `type: harness`，**每场景恰好 1 个「DSH 会话」**；
    一板一分区（`panelPartition` 按面板 id 分区），每个场景面板写 `sessionTitle` / `sessionId` 绑定**本场景专属会话**；场景内单会话、不显示全局侧栏；
  - 场景 JSON 文件名必须等于 `id`，面板坐标不能超出 `cols`；
  - DSH 面板单会话注入为三轨道 `0px minmax(0, 1fr) 0px`（`main.js` 与 `renderers.js` 两份内容同步；当前渲染层只走自己那份）；
  - 增删场景面板后同步 `scenarios/_场景身份索引.md` 与工作台回归断言。
- **平台约定**：技能、智能体配置走版本接口；调度策略改库（`/settings/dispatch`）；审计只追加。
- **危险操作**：修改数据或删除文件前先确认；未经明确要求不重置演示数据、不清空数据库。

## 5. 常用入口

```powershell
dev up            # 起平台（WSL 常驻 + 5 容器；工作台会自动跑，手动跑幂等）
dev ps            # 5 个容器状态（api/postgres/redis healthy，web/worker Up 即正常）
dev health        # {"status":"ok",...}
start.cmd         # 在 agentmatrix-workbench\ 下起工作台（自动拉起平台 + DSH 引擎）
```

- 干净克隆（换机器或新环境）：仓库不含 `node_modules`、`引擎/.dsh`、`.env`、`data/`；
  先 `Copy-Item .env.example .env`，再在 `外壳/` 与 `引擎/` 各执行 `npm install`，运行一次
  `node agentmatrix-workbench/scripts/setup-dsh-home.cjs`，最后 `start.cmd`；引擎起来后跑一次
  `node agentmatrix-workbench/工具/场景会话.mjs ensure --seed` 重建 5 条场景专属会话。完整步骤见 README「首次安装（干净克隆）」。
- 前端 http://127.0.0.1:5173 ｜ 接口 http://127.0.0.1:8000/docs ｜ 工作台 DSH 引擎 127.0.0.1:3083
- 演示账号：`dev@agentmatrix.local` / `ops@agentmatrix.local` / `admin@agentmatrix.local` / `viewer@agentmatrix.local`，密码 `AgentMatrix@2026`
- 模型：当前开发机 `.env` 为 `LLM_PROVIDER=deepseek`（真实调用）；`.env.example` 默认 `mock`（离线可跑）
- 仓库：https://github.com/YuanEternalR/AgentMatrix-SC-Atest （公开；引擎依赖与凭据不在库内）

## 6. 交接

一轮工作结束前：项目级更新 `docs/HANDOFF.md`（最后更新、当前规模、已完成验证、下一步），
必要时在 `docs/workbench-template.md` 追加轮次；场景级跑 `node 工具\场景记忆.mjs 交接 --场景 <名字>`
（归档旧版 + 补 §〇）再 `check`，不过不换会话。下一个新会话从本文件找到入口，
再读 HANDOFF 接上进度，不需要额外复述项目背景。
