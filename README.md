# AgentMatrix-SC · 面向供应链的智能体矩阵工作台

> 毕业设计项目。主线是**系统**（智能体矩阵工作台），研究点是**调度策略**（大模型规划 / 小模型与 skill 执行的分配机制）。
>
> 仓库：<https://github.com/YuanEternalR/AgentMartrix-SC-R>（公开版；工作台模板、DSH 引擎依赖与凭据不随仓库分发，见「首次安装（干净克隆）」）。

## 当前状态

| 模块 | 状态 | 验证方式 |
|---|---|---|
| 调度策略层（5 策略 + 硬过滤 + 可解释打分 + 注册表） | 已实现 | 24 条单测通过 |
| 离线评测 harness（仿真执行器、指标、报告生成） | 已实现 | `scripts/evaluate_strategies.py` 产出 `docs/experiments/` |
| 论文用策略对比结论 | 已成型 | `docs/dispatch-strategy.md` |
| WSL2 + Docker Engine 环境 | 已就绪 | `docker run hello-world` 通过，镜像加速生效 |
| Compose 编排（Postgres 16 / Redis 7 / API / Worker / Web） | 已跑通 | 5 个容器运行（api/postgres/redis healthy，web/worker Up），`/health` 返回 `{"database":"ok","redis":"ok"}` |
| 数据模型（19 张表）与 Alembic 迁移 | 已实现 | `alembic upgrade head` 成功，11 个迁移已应用 |
| FastAPI 骨架（`/health`、`/api/v1/meta`、`/docs`） | 已实现 | 三个端点实测 HTTP 200 |
| 登录与 RBAC（JWT + 四角色） | 已实现 | 登录、`/auth/me`、角色守卫 |
| 任务路由（调度决策落库 + 打分拆解） | 已实现 | 决策含因子与淘汰原因 |
| Worker 与工作流执行器（可恢复） | 已实现 | 审批暂停 → 批准后从游标恢复 |
| 端到端冒烟测试 | 通过 | `scripts/smoke-test.ps1`，两条工作流均通过 |
| 前端（登录 / 工作台 / 矩阵 / 任务详情 / 运行详情） | 已实现 | 类型检查 + 生产构建通过，真实截图见 `docs/screenshots/` |
| 四条业务链路 | 已实现 | 订单延迟闭环 / 区域履约诊断 / 周度补货建议 / 承运商风险巡检 |
| 监控仪表盘（吞吐/成功率/双耗时口径/成本） | 已实现 | ECharts 图表按需加载，数据来自真实 run_steps |
| 产物归档与下载 | 已实现 | `artifacts` 表 + RFC 5987 中文文件名下载 |
| 失败重试与死信队列 | 已实现 | 错误分类 + 指数退避；`scripts/fault-test.ps1` 全部通过 |
| 告警规则与事件 | 已实现 | 指标+比较符+阈值；自动触发/去重/恢复，支持确认 |
| 工作流 DAG（只读渲染） | 已实现 | 运行详情按节点状态着色，点节点联动步骤详情 |
| 工作流设计器（编辑 + 校验 + 存新版本） | 已实现 | 加节点/连线/删除/拖拽定位、服务端校验、保存为不可变新版本 |
| 版本对比 | 已实现 | `GET /workflows/{code}/diff`，节点增删/字段变更/连线增删，忽略布局坐标 |
| 浏览器端到端测试 | 通过 | `dev e2e` —— 真实 UI 跑完登录到审批、审计、建技能、在线测试、图表导出、全局搜索、确认弹窗（17 步断言） |
| 路由冒烟 | 通过 | `node tests/e2e/routes.mjs`：18 个页面逐页断言「无运行时错误 + 主内容非空」 |
| 工作台原生面板 | 通过 | `node tests/e2e/workbench.mjs`：18 步（5 场景 21 面板；20 个原生面板断言 webview/iframe=0，DSH 会话面板恰好 1 个 webview；刷新不掉注册 + 矩阵/抽屉/图表/必填/设计器/试算/新建/助手） |
| 技能库（界面） | 已实现 | `/skills`：新建（内置/HTTP）、按 Schema 试运行、版本、引用检查、故障注入 |
| 智能体管理（界面） | 已实现 | `/agents`：新建、绑技能、在线测试（工具轨迹 + Token/成本）、草稿/发布、版本对比 |
| 审计日志（只追加） | 已实现 | `audit_logs` + 触发器禁改禁删；`scripts/check-audit.ps1` 18/18 |
| 图表导出 PNG / CSV | 已实现 | ECharts `getDataURL` + option 反推 CSV（BOM）；工作流图走 SVG→PNG |
| 架构文档 | 已写 | [docs/architecture.md](docs/architecture.md)：五层架构、调度层、数据模型、部署与偏差记录 |
| 调度策略可配置 | 已实现 | `/settings/dispatch`：五策略、六因子权重、试算、保存即生效、变更进审计 |
| 交互与反馈 | 已实现 | `Ctrl/Cmd+K` 全局搜索、Toast 反馈、自定义确认弹窗、列表骨架屏 |
| 工作台（场景化桌面壳） | 已实现 | `agentmatrix-workbench/`：改造自 luanyujia-workbench 模板（MIT，模板本身未随本仓库分发）；**5 个场景、21 个面板** = 20 个原生渲染器 + 1 个「DSH 会话」webview（有意内嵌）；打开工作台即自动拉起平台与 DSH 引擎 |
| DSH 引擎接入 | 已实现 | 工作台内嵌真实 DSH（`@deepseek-ai/dsh 0.2.2-rc.5`，profile `workbench`，端口 3083）；总览的「DSH 会话」面板、以及 4 个 `agentmatrix_*` DSH 工具 |
| 设计指南 | 已写 | `/guide` 页面 + [docs/design-guide.md](docs/design-guide.md)：四步注册链路与常见问题 |
| 接口文档 | 已写 | [docs/api.md](docs/api.md)：52 条路径 / 60 个操作、字段说明、错误码、调用示例 |
| **DSH 工具连接器** | 已实现并安装 | `dsh-plugins/agentmatrix-tools/`：4 个工具，DSH 智能体可直接驱动工作台 |
| 五类可视化 | 已实现 | 矩阵、DAG、协作拓扑、桑基图、业务看板 |
| 并发压测 | 已测 | 50 并发 P95 1.83s；100 并发退化为两批次。见 [报告](docs/experiments/load-test.md) |

### 最近更新（2026-11-23）

- **工作台 DSH 会话面板布局修复**：精简注入从单轨道改为三轨道 `0px minmax(0, 1fr) 0px`，
  解决「左侧栏收起时对话框偏在右边、越打字越往左挤」（引擎三列是显式 `grid-column:1/2/3`，单轨道会生成隐式自动列）。
- **平台随工作台自启动**：打开工作台即探 `8000/health`，没起就后台跑 `dev.cmd up`；
  启动页显示「平台启动中/已就绪」，面板请求会等平台就绪；`AM_PLATFORM=0` 可关闭。
- **DSH 引擎集成到项目**：`@deepseek-ai/dsh 0.2.2-rc.5`，profile `workbench`，
  `DSH_HOME=引擎/.dsh`，端口 3083；总览新增「DSH 会话」面板（原「DSH 大脑」面板已于 2026-11-23 按反馈删除），`agentmatrix_*` 4 个工具可驱动平台。
- **新 DSH 对话自动加载项目上下文**：重新启用 DSH 的 `agent-instructions`，仓库根 [`AGENTS.md`](AGENTS.md) 随每个新会话自动加载（内含 HANDOFF 阅读顺序、当前基线、工作纪律）；`agentmatrix-workbench/scripts/setup-dsh-home.cjs` 会把这条 profile 配置一起生成。
- **切换 / 加载淡入淡出**：场景切换用「遮罩」——先淡入到完全不透明（约 200ms）再换 DOM（避免半透明时露出空白），等面板请求回来（`window.am.pending()`）再淡出；面板从「加载中」到数据 200ms 淡入，DSH webview 就绪后 250ms 淡入；开机加载页期间隐藏内嵌 webview、目标场景先在遮罩后渲染，消除加载中闪帧。
- **回归测试与基线同步**：工作台 5 场景 21 面板（20 原生 + 1 DSH webview），`workbench.mjs` 18 步；
  平台实测：52 条路径 / 60 个操作、19 张表 / 11 个迁移、单元测试 102（宿主机）/128（容器）、
  DataCo 65,752 单、矩阵覆盖 26/32（81.25%）、累计运行 53 次（成功率 98.08%，成本 $0.0167）。

## 文档索引

| 文档 | 内容 | 对应论文 |
|---|---|---|
| [AGENTS.md](AGENTS.md) | **新 DSH 对话自动加载**：开工顺序、当前基线、工作纪律（含 HANDOFF 入口） | 全篇 |
| [HANDOFF.md](docs/HANDOFF.md) | **项目交接（新会话从这里开始）**：现状、约束、命令、下一步 | 全篇 |
| [report/](docs/report/) | 进度总结报告 DOCX（`build_progress_report.py` 生成，数字改动后重跑） | 全篇 |
| [design-guide.md](docs/design-guide.md) | 技能/能力/智能体/策略怎么设计与注册 | 第四章（使用视角） |
| [workbench-template.md](docs/workbench-template.md) | 工作台：改用成熟模板 + 换领域的记录（含引擎复用与编码坑） | 第四章（架构演进） |
| [architecture.md](docs/architecture.md) | 五层架构、调度层设计、数据模型、部署拓扑、技术栈偏差 | 第四章 |
| [dispatch-strategy.md](docs/dispatch-strategy.md) | 五种策略、实验设计、对比结果、有效性威胁 | 第五章 |
| [load-test.md](docs/experiments/load-test.md) | 并发压测方法与结果、瓶颈分析 | 第五章 |
| [dsh-integration.md](docs/dsh-integration.md) | 以 DSH 为运行时的接口调研与增量路径 | 第三章 |
| [industry-chain.md](docs/industry-chain.md) | 产业链调研：投入产出表方法、数据源、与矩阵行的关系 | 第四章 |
| [data-sources.md](docs/data-sources.md) | 真实数据接入：DataCo 订单、投入产出表、字段映射与不可得项 | 第五章 |
| [matrix-stage-basis.md](docs/experiments/matrix-stage-basis.md) | 矩阵行的数据依据：153 部门映射与关联度 | 第四章 |
| [real-runs/](docs/experiments/real-runs/) | 真实模型运行记录：调度决策、token、成本、耗时 | 第五章 |
| [requirements-audit.md](docs/requirements-audit.md) | 需求符合度审计：逐条对照与差距清单 | 第一章 |
| [api.md](docs/api.md) | 接口约定、端点清单、错误码、调用示例 | 附录 |
| [environment-setup.md](docs/environment-setup.md) | 本机实测环境、安装步骤、回滚 | 附录 |

### 界面截图

| 工作台 | 任务详情（打分拆解） |
|---|---|
| ![工作台](docs/screenshots/02-workbench.png) | ![任务详情](docs/screenshots/03-task-decision.png) |

| 智能体矩阵（覆盖率与缺口） | 监控仪表盘 |
|---|---|
| ![矩阵](docs/screenshots/05-matrix.png) | ![仪表盘](docs/screenshots/10-monitor.png) |

| 运行详情（步骤轨迹与审批） | 工作流图（按状态着色） |
|---|---|
| ![运行详情](docs/screenshots/04-run-detail.png) | ![DAG](docs/screenshots/15-run-dag.png) |

| 死信队列 | 告警规则与事件 |
|---|---|
| ![死信](docs/screenshots/12-dead-letters.png) | ![告警](docs/screenshots/14-alerts.png) |

| 工作流设计器（选中条件节点） | 设计器校验（错误 + 警告） |
|---|---|
| ![设计器](docs/screenshots/18-designer.png) | ![校验](docs/screenshots/19-designer-validate.png) |

| 可视化（拓扑 / 桑基 / 业务看板） |
|---|
| ![可视化](docs/screenshots/20-analytics.png) |

| 审计日志（可筛选、可导出） | 展开某条：变更前后对照 |
|---|---|
| ![审计](docs/screenshots/34-audit.png) | ![审计详情](docs/screenshots/35-audit-detail.png) |

| 技能库（平均耗时/成功率来自真实执行） | 技能试运行（按 Schema 生成表单） |
|---|---|
| ![技能库](docs/screenshots/37-skills.png) | ![技能详情](docs/screenshots/38-skill-detail.png) |

| 智能体列表 | 在线测试：工具轨迹 + 版本对比 |
|---|---|
| ![智能体](docs/screenshots/39-agents.png) | ![智能体详情](docs/screenshots/40-agent-detail.png) |

| 调度策略与权重（改 → 试算 → 保存） | 设计指南（四个概念怎么串起来） |
|---|---|
| ![调度](docs/screenshots/41-dispatch-settings.png) | ![指南](docs/screenshots/42-guide.png) |

| 工作台：模板化桌面壳（场景标签 + 面板 + AI 会话） | 全局搜索（Ctrl+K） |
|---|---|
| ![工作台](docs/screenshots/51-workbench-final.png) | ![设计器](docs/screenshots/50-workflow-designer.png) |

| 图表导出（每张图右上角 PNG / CSV） |
|---|
| ![导出](docs/screenshots/36-analytics-export.png) |

| 设计器：拖拽 + 版本对比 |
|---|
| ![版本对比](docs/screenshots/21-designer-diff.png) |

| 产物下载 |
|---|
| ![产物](docs/screenshots/11-run-artifact.png) |

访问 http://127.0.0.1:5173 。



## 启动

### 首次安装（干净克隆）

仓库只提交**源码**：`node_modules`、`agentmatrix-workbench/引擎/.dsh`（DSH 家目录与凭据）、`.env`、`data/` 都不在版本库里。
克隆后不能直接运行 `start.cmd`，安装步骤如下（Windows 10/11）：

```powershell
git clone https://github.com/YuanEternalR/AgentMartrix-SC-R.git
cd AgentMartrix-SC-R
Copy-Item .env.example .env          # 默认 LLM_PROVIDER=mock（离线可跑）；真实模型改 deepseek 并填 LLM_API_KEY

# 1) 工作台外壳的 Electron 运行时（约 100 MB，只装一次）
cd agentmatrix-workbench\外壳
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install
node node_modules\electron\install.js

# 2) 内置 DSH 引擎的依赖（@deepseek-ai/dsh 0.2.2-rc.5）
cd ..\引擎
npm install
cd ..\..

# 3) 生成工作台专用 DSH 家目录（profile=workbench、唯一工作区、复制本机 ~/.dsh 凭据、装本仓库插件）
node agentmatrix-workbench\scripts\setup-dsh-home.cjs
```

- 第 3 步需要本机 `~/.dsh/.credentials.yaml`（DSH 已登录过）才会自动复制模型凭据；没有就先按 DSH 官方方式登录一次。
- 插件安装依赖 `pnpm`；报「插件安装失败（可能没有 pnpm）」时执行 `npm install -g --allow-scripts=pnpm pnpm` 后重跑第 3 步。
  没装成也不影响工作台启动，只是 DSH 会话里没有 `agentmatrix_*` 工具。
- 装完用 `cd agentmatrix-workbench` → `start.cmd` 启动；以后不用重复安装。
- **真实订单数据不在仓库内**（`data/` 被忽略）：从
  [Kaggle DataCo](https://www.kaggle.com/datasets/shashwatwork/dataco-smart-supply-chain-for-big-data-analysis)
  下载原始 CSV，先 `python scripts/import_dataco.py --csv <原始csv> --out data/dataco_orders.csv`，
  再 `dev up` 后跑 `wsl -d Ubuntu-AgentMatrix -u root -- bash scripts/load_dataco.sh` 导入 `supply_orders`。
  不导入也能启动与演示审批/技能/工作流，只是订单查询、业务看板和履约诊断没有数据。
- 平台侧还需要 WSL2 + Docker Engine（本项目不用 Docker Desktop），完整步骤见 [docs/environment-setup.md](docs/environment-setup.md)。

### 工作台启动（推荐）

```bat
cd agentmatrix-workbench
start.cmd
```

`start.cmd` 会依次拉起：AgentMatrix 平台（接口 8000 / 站点 5173，后台跑 `dev.cmd up`）+ DSH 引擎
（[工作台配置.ini](agentmatrix-workbench/工作台配置.ini) 的 `DSH_PORT=3083`；端口已在监听就复用），
启动页显示两边的进度，落地「工作台总览」。仅复用已在运行的平台时，启动前设 `AM_PLATFORM=0`。

### 仅启动平台（网页端 / 接口联调）

在仓库根目录用 `cmd` 或 PowerShell 执行：

```bat
dev up          :: 启动全部服务（后台，含 WSL 常驻）
dev ps          :: 查看容器状态（api/postgres/redis 应 healthy，web/worker Up 即正常）
dev logs api    :: 跟踪 api 日志
dev migrate     :: 执行数据库迁移
dev seed        :: 灌入演示种子数据（幂等）
dev health      :: 检查依赖健康
dev e2e         :: 浏览器端到端测试（真实 UI）
dev down        :: 停止并移除容器（保留数据卷）
```

网页端 http://127.0.0.1:5173，接口文档 http://127.0.0.1:8000/docs。

端到端自检（登录 → 建任务 → 调度 → 执行 → 审批 → 完成）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-test.ps1
```

## 测试

| 层次 | 命令 | 覆盖 |
|---|---|---|
| 单元测试 | `python -m pytest` | 调度策略、打分、规划器回退、评测可复现（宿主机 102 条；容器内 128 条） |
| API 冒烟 | `scripts\smoke-test.ps1` | 两条工作流：建任务→调度→执行→审批→完成 |
| 故障演练 | `scripts\fault-test.ps1` | 自动重试、死信落库、人工重试恢复 |
| 浏览器 E2E | `dev e2e` | 真实 UI：登录→发起→看决策→审批→成功→矩阵/告警（17 步） |
| 路由冒烟 | `node tests/e2e/routes.mjs` | 18 个页面逐页断言：无运行时错误 + 主内容非空 |
| 工作台回归 | `node tests/e2e/workbench.mjs` | 18 步：5 场景 21 面板、原生面板不嵌网页（DSH 会话面板除外）、刷新不掉注册（需先退出工作台） |

E2E 使用 `playwright-core` 驱动系统已装的 Edge（当前网络下载 Chromium 不稳定），可用 `EDGE_PATH` 指定其他 Chromium 内核浏览器。失败时自动截图到 `tests/e2e/artifacts/`。

演示账号（密码统一 `AgentMatrix@2026`）：
`admin@agentmatrix.local` / `dev@agentmatrix.local` / `ops@agentmatrix.local` / `viewer@agentmatrix.local`

模型：当前开发机的 `.env` 是 `LLM_PROVIDER=deepseek`（真实调用）；`.env.example` 默认 `mock`，
复制后不填 Key 也能离线跑完全部链路。

首次运行需准备环境变量：

```powershell
Copy-Item .env.example .env
```

- API 文档：http://127.0.0.1:8000/docs（`dev url` 直接打开）
- 数据库：`127.0.0.1:5433`，Redis：`127.0.0.1:6380`

注意：Windows 侧没有 `docker` 命令，所有容器操作都通过 `dev.cmd` → `wsl` 转发。

### WSL 虚拟机常驻

WSL2 默认在空闲约 1 分钟后回收虚拟机，容器会跟着重启（日志里表现为 `Up 2 seconds`）。
开发机已在 `%USERPROFILE%\.wslconfig` 中设置：

```ini
[wsl2]
vmIdleTimeout=86400000
```

`dev up` 还会起一个隐藏的 WSL 常驻会话；改动 `.wslconfig` 需 `wsl --shutdown` 后生效，删除该文件即可恢复默认行为。

## 常用命令（不依赖容器）

环境要求：Python 3.11+（开发机为 3.14.7，调度层不依赖第三方库）。

```bash
# 1. 跑单测
python -m pytest

# 2. 生成策略对比报告
python scripts/evaluate_strategies.py --count-per-type 8
```

产物：
- `docs/experiments/dispatch-comparison.md`
- `docs/experiments/dispatch-comparison-<utc>.csv`

## 目录

```
agentmatrix-sc/
├─ AGENTS.md                       # 新 DSH 对话自动加载：开工顺序 + 当前基线 + 工作纪律
├─ apps/
│  ├─ api/                         # FastAPI + SQLAlchemy + Alembic（19 张业务表 / 11 个迁移）
│  │  └─ app/services/dispatch/    # 调度层（5 策略 + 硬过滤 + 打分）
│  └─ web/                         # Vite + React 18 + TypeScript + ECharts
├─ agentmatrix-workbench/          # 场景化桌面工作台（Electron，5 场景 21 面板）
│  ├─ 外壳/                        # 主进程 + 渲染层 + scenarios/*.json（node_modules 不进库）
│  ├─ 引擎/                        # 内置 DSH 引擎（profile=workbench，端口 3083；node_modules/.dsh 不进库）
│  └─ 说明/                        # 使用说明 + 记忆约定
├─ dsh-plugins/agentmatrix-tools/  # DSH 插件：4 个 agentmatrix_* 工具
├─ docs/                           # 架构、接口、策略、实验、截图、进度报告
├─ infra/docker-compose.yml        # api / worker / web / postgres / redis
├─ scripts/                        # 导入、压测、取证、自检、评测
└─ tests/                          # 单元测试（102/128）+ E2E + 路由冒烟
```


## 调度策略一览

| 编号 | 策略 | 说明 |
|---|---|---|
| S0 | 全大模型 | 质量上限基线 |
| S1 | 固定规则 | 注册顺序，下界基线 |
| S2 | 加权打分 | 六因子线性加权，产品基线（默认值以 `/settings/dispatch` 为准） |
| S3 | SLA 成本优先 | 质量下限 + SLA 余量后取最低成本 |
| S4 | 大模型规划 + 规则校验 | 规划器只能在**可行集**内挑，无权绕过硬过滤 |

详细设计与实验结论见 [docs/dispatch-strategy.md](docs/dispatch-strategy.md)。

## 运行环境

实测：`desktop.docker.com` 不可达、Docker Hub 被墙，因此**不装 Docker Desktop**，改用 WSL2 + Docker Engine（清华源 + 国内镜像加速）。该路线已在开发机装好并长期使用：

- WSL2 发行版 `Ubuntu-AgentMatrix` + Docker Engine + `docker compose v2`
- 5 个容器（api / worker / web / postgres / redis）都在运行（api/postgres/redis healthy；web/worker 无 healthcheck，Up 即正常）；`dev health` 返回 `{"status":"ok"}`
- 镜像加速与 apt 源已配置；`dev up` 会起常驻会话，避免 WSL 空闲回收导致容器重启

完整探测数据、选型理由与回滚步骤见 [docs/environment-setup.md](docs/environment-setup.md)。

## 约定

- UI 文案简体中文，代码与注释英文，文档中文。
- 不硬编码演示数据到组件；数据来自数据库与种子脚本。
- 不伪造运行结果、测试结果与截图；无法验证的内容标注未验证。

## 致谢与许可

- 桌面工作台改造自 **luanyujia-workbench** 公开模板（MIT，模板未随本仓库分发，仅保留其 `agentmatrix-workbench/LICENSE`）。
- 智能体运行时使用 **DeepSeek Harness（`@deepseek-ai/dsh 0.2.2-rc.5`）**；本仓库只提交引擎依赖清单，不提交其代码与凭据。
- 订单数据来自 DataCo 公开数据集，来源与字段映射见 [docs/data-sources.md](docs/data-sources.md)。
- 论文正文尚未开始；本仓库暂无根级许可证，引用的第三方组件各自遵循其原许可。
