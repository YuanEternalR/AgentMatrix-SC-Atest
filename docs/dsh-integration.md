# DSH 集成方案（以 DSH 为运行时）

> 最后更新：2026-11-23
> 决策：工作台以 **DSH 作为智能体运行时**（agent / skill / session / LLM 都复用 DSH 能力），
> 工作台负责编排、调度策略、审批、观测与界面。
> 本机实测：`@deepseek-ai/dsh` 0.2.2-rc.5，工作台 0.2.1-rc.3；profile=`workbench`，
> `DSH_HOME=agentmatrix-workbench/引擎/.dsh`，Web GUI `http://127.0.0.1:3083`。
> 记录实测到的 DSH 接口事实与可落地的增量路径。

## 1. 实测到的 DSH 结构

DSH 是 **Cordis 插件树**，当前 `workbench` profile 加载了 200 个插件。与"运行时"直接相关的：

| 能力 | 插件包 | 与本项目的关系 |
|---|---|---|
| 智能体循环 | `@deepseek-ai/dsh-agent` | 替代自研的"提示词组装 + 工具调用循环" |
| 技能/工具 | `@deepseek-ai/dsh-skill`、`dsh-tool-skill`、`dsh-skill-filesystem` | 技能的注册与发现机制（本项目现行 skill 注册表可映射过去） |
| 会话 | `dsh-session`、`dsh-session-persistence-jsonl`、`dsh-session-query-sqlite` | 对话与上下文持久化、可查询 |
| 模型 | `dsh-llm`、`dsh-llm-pi-ai`、`dsh-deepseek-llm-api-extensions`、`dsh-agent-default-model` | 真实模型调用、重试、默认模型 |
| 子智能体 | `dsh-subagent`、`dsh-subagent-spawn-in-process`、`dsh-subagent-fork-in-process` | 多智能体协作 |
| 工作流 | `dsh-workflow-ptc`、`dsh-tool-workflow` | 与本项目 DAG 的关系需评估（是否二选一） |
| 可观测 | `dsh-token-meter`、`dsh-otel`、`dsh-session-telemetry-otel` | Token 计量与追踪，可直接替代本项目的成本估算 |
| 沙箱/审批 | `dsh-sandbox-local`、`dsh-user-approval`、`dsh-permission-presets` | 工具执行隔离与人工审批 |
| API 网关 | `dsh-api-gateway`、`dsh-api-remote-access`、`dsh-typert-*` | 类型化 RPC，GUI 与后端之间的通道 |

## 2. 插件安装与配置方式

工作台使用专用 profile：`agentmatrix-workbench/引擎/.dsh/profiles/workbench/`（`DSH_HOME=agentmatrix-workbench/引擎/.dsh`，由 `agentmatrix-workbench/scripts/setup-dsh-home.cjs` 生成）：

```
package.json        # dsh.profile.bundles：dsh-base / dsh-web-app / dsh-agentmatrix-tools
cordis.yml          # 空树，由 bundle 组合
cordis.patch.yml    # 覆盖层：按 id 覆盖配置 / 禁用 / 插入插件
```

`package.json` 里的 `dsh-agentmatrix-tools` 用 `link:` 指向仓库的 `dsh-plugins/agentmatrix-tools`，改仓库代码即生效。

> 干净克隆时先装依赖再生成家目录：仓库不带 `外壳/node_modules`（Electron）与 `引擎/node_modules`（DSH 包），
> 也没有 `引擎/.dsh`。先按 [`agentmatrix-workbench/README.md`](../agentmatrix-workbench/README.md) 的「首次安装」
> 装完这两处依赖，再跑 `node agentmatrix-workbench/scripts/setup-dsh-home.cjs`；否则没有 `dsh` CLI 可装插件。

`cordis.patch.yml` 的条目形如：

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: high
```

**结论**：自定义能力 = 一个 Cordis 插件包（npm 包），在 `package.json` 的 bundles 或 patch 里注册。

## 3. 本地 API 现状

- 工作台使用 `http://127.0.0.1:3083`（`工作台配置.ini` 的 `DSH_PORT`）；根路径无 token 返回 **401**，`/openapi.json` 返回 **404**——接口是 `typert` 类型化 RPC，schema 不对外暴露。
- **启动顺序**：端口在监听就复用（日志 `reuse: port already listening`）；没在跑就由工作台自己拉起——node 直跑 `引擎/node_modules/@deepseek-ai/dsh/lib/bin.js workbench --no-open --port 3083`（profile=`workbench`，`DSH_HOME=引擎/.dsh`），从 stdout 抓 `?token=`。
- 复用外部实例时拿不到它的启动 token（主界面走本机保命入口 `/chat` 实时转发）；工作台自己拉起的实例才能稳定内嵌 DSH 会话面板。

**所以不能"直接调 HTTP"作为通用集成方式**，除非先拿到 GUI 侧 token；当前稳定链路是 DSH 插件（见 §5）。

## 4. 建议的集成路径（增量，不重写）

保留已验证的部分，只替换"最应由 DSH 承担"的那一层：

| 阶段 | 做什么 | 产出 | 风险 |
|---|---|---|---|
| **S1** | 把执行器的 `LLMGateway` 换成"调用 DSH 智能体会话" | 一次真实的 LLM 调用跑通工作流 | 需要宿主侧 `ctx.agents`（接口已可见，见 §7） |
| S2 | 将 15 个内置技能注册为 DSH 技能/工具 | 智能体能通过 DSH 调用领域技能 | 需要技能注册 API |
| S3 | 用 `dsh-token-meter` 替换本项目的成本估算 | 真实 token 与费用 | 低 |
| S4 | 用 `dsh-subagent` 实现"规划器派生子智能体执行" | 与论文的"大模型规划"更贴合 | 中 |
| S5 | 工作台改为调用 DSH 的会话查询做轨迹展示 | 观测数据同源 | 低 |

**不动的部分**：5 种调度策略、工作流 DAG 与校验、审批、重试/死信、告警、矩阵与可视化、UI。
这些是本课题的系统亮点与研究点，不应交由 DSH 承担。

## 5. 已实现：DSH 工具连接器（v0.1）

在拿到官方插件教程后，已按 Cordis 规范实现并安装了一个 **bundle**：
`dsh-plugins/agentmatrix-tools/`

它将工作台能力暴露为 DSH 工具，DSH 中的智能体可直接调用：

| 工具 | 作用 | 返回 |
|---|---|---|
| `agentmatrix_create_task` | 在矩阵里发起任务 | 任务 ID、派给谁、策略、分数、前 3 个因子、被淘汰候选 |
| `agentmatrix_explain_dispatch` | 解释某次调度 | 全量因子（raw/weight/contribution）与淘汰原因 |
| `agentmatrix_run_status` | 查运行轨迹 | 状态、成本、Token、每节点状态与尝试次数 |
| `agentmatrix_matrix_coverage` | 看矩阵覆盖 | 覆盖率、缺口清单 |

当前 `workbench` profile 的 bundles 已包含 `dsh-agentmatrix-tools`（见 §2），这 4 个工具在工作台内嵌的 DSH 会话里可用。

**方向说明**：这是 **DSH → 工作台** 的方向——DSH 负责对话与规划，工作台负责领域执行与可观测。
在 DSH 中描述需求即可建任务并取回调度依据，"基于 DSH"因此成为可演示的事实。

**实现要点**

- `inject: ['tools']` 声明依赖，工具注册是 Cordis effect，卸载自动清理；
- `defineTool` 用动态 import 加载并带降级，避免宿主未提供该模块时插件整体失败；
- 通过 HTTP 调工作台 API，token 失效自动重登一次；
- 配置可用环境变量覆盖：`AGENTMATRIX_API` / `AGENTMATRIX_EMAIL` / `AGENTMATRIX_PASSWORD`。

**验证**

```powershell
node dsh-plugins/agentmatrix-tools/test.mjs
```

离线用假 `ctx.tools` 捕获注册结果，并连真实后端跑通：建任务 → 分配智能体 → 查运行 → 解释调度 → 读矩阵。
实测 4 个工具全部注册成功，`agentmatrix_create_task` 返回了 `exception-rules` 的分配结果与打分拆解。

**安装与回滚**

```powershell
node dsh-plugins/install.mjs --dry-run   # 先看要做什么
node dsh-plugins/install.mjs             # 安装（自动备份 profile 配置）
node dsh-plugins/install.mjs --uninstall # 卸载并恢复
```

安装会：备份 `package.json`/`cordis.patch.yml` → 用 DSH 自带 pnpm 装 `link:` 依赖 → 把 bundle 名写入 `dsh.profile.bundles`。
**需要重启 DSH 才会加载**。`install.mjs` 默认目标是桌面端 `desktop` profile；工作台专用 profile 由 `node agentmatrix-workbench/scripts/setup-dsh-home.cjs` 生成（其中用 `dsh plugin --profile workbench add link:...` 安装本插件）。

> 注意：`install.mjs` 里写死了本机 DSH 自带 pnpm 的路径（`.../dependencies/pnpm/bin/pnpm.mjs`），只适用于本机桌面端；
> 干净克隆 / 工作台应使用 `setup-dsh-home.cjs`，或直接 `dsh plugin --profile workbench add link:<仓库根>/dsh-plugins/agentmatrix-tools`。

## 5.1 问题记录：schema 的三层规则存在冲突

插件从"加载失败"到"加载成功但调用失败"再到"可用"，共遇到三个不同问题：

| # | 现象 | 报错 | 原因与修正 |
|---|---|---|---|
| 1 | 插件 `fiberPhase: failed` | `parameters.payload.required must be true when present` | DSH 的 schema DSL 不接受 `required: false`。可选参数应**省略**该字段 |
| 2 | 仍 `failed` | `parameters.payload.additionalProperties must be explicitly true or false` | `type: 'object'` 的参数与输出**必须**显式声明 `additionalProperties` |
| 3 | 加载成功，但**每次对话处理失败** | `Invalid schema for function 'agentmatrix_create_task': {"type":"string","required":true,...} is not of type "string"` | DSH 把属性定义**原样**作为 JSON Schema 发给模型 API，而 `required: true` 写在单个属性里不是合法 JSON Schema（`required` 只能是父级的字符串数组） |

**结论：属性里一条 `required` 都不能留。** 但 DSH 自身的加载校验又会检查"如果写了 required，必须是 true"——
两条规则叠加后只剩一个安全写法：**完全不写 `required`**。

必填约束因此改为在 `execute` 里手动校验，抛出的错误会作为工具结果回给模型，模型据此补齐参数——
效果上仍是"模型自行补全参数"，只是校验位置从 schema 移到代码。

这三条都已写成 `test.mjs` 的断言（第 5、5.1、6、7 组），以后改 schema 会先在离线测试里失败。

**排查方式**：需区分两个错误面：
- 加载期问题看 `plugin_manager` 返回的 `fiberPhase` 与 `diagnostic`；
- 调用期问题看会话里的 `request_id` 报错（那是模型 API 拒绝了 schema）。

## 5.2 迭代方式：用 link 而不是 file

`pnpm add file:` 会把插件**拷贝**进 profile，改仓库代码不生效，每次都要重装。
改用 `link:` 后，profile 的 `node_modules` 是指向仓库的 Junction（Windows）：
改仓库即改运行代码，装一次即可反复迭代。

```powershell
node dsh-plugins/install.mjs            # 内部使用 link:
node dsh-plugins/agentmatrix-tools/test.mjs
```

注意：插件从 `failed` 恢复需要**重启 DSH**；HMR 只对正常加载过的插件生效。

## 5.3 验证记录：第一次真实调用（2026-11-22 17:24）

在 DSH 新会话里输入「看一下矩阵现在覆盖多少」，模型自动选中 `agentmatrix_matrix_coverage`
并返回真实数据：

```
总体覆盖：78.57%（28 格里覆盖 22 格，共 10 个智能体；当时为 7 阶段，后调整为 6 阶段，现为 8 阶段 32 格 / 15 个智能体）
缺口 6 个：需求计划×感知与解析、需求计划×执行与协同、采购寻源×执行与协同、
          运输物流×分析与预测、合规风控×感知与解析、合规风控×执行与协同
```

> 2026-11-23 当前：8 阶段 × 4 能力 = 32 格，覆盖 26 格（81.25%），6 个缺口；种子 15 个智能体（演示库当前 34 个）。当前缺口：需求计划×感知与解析、采购寻源×执行与协同、生产协同×执行与协同、售后逆向×决策与规划、合规风控×感知与解析、合规风控×执行与协同。

**后端日志佐证**（`docker logs agentmatrix-sc-api-1`）：

```
172.18.0.1:47048 - "POST /api/v1/auth/login" 200 OK
172.18.0.1:47064 - "GET  /api/v1/matrix"     200 OK
```

`172.18.0.1` 是宿主机网关（DSH 主进程直连），浏览器流量则来自 `172.18.0.3`
（web 容器代理）——两者可区分，证明请求确实由插件发出，而非页面轮询。

### 复现步骤

1. `dev up`（后端必须在跑，否则工具返回连接失败）
2. **新开一个 DSH 对话**（工具清单在会话创建时固定，老会话看不到新工具）
3. 输入「看一下矩阵现在覆盖多少」，或点名「用 agentmatrix_matrix_coverage 看看矩阵覆盖率」

### 已知注意事项

| 现象 | 原因 | 处理 |
|---|---|---|
| 老会话里模型不知道有这个工具 | 会话工具清单不刷新 | 新开会话 |
| 工具报连接失败 | WSL 闲置回收了容器 | `dev up` |
| 插件不在列表里 | profile 的 bundles 被 UI 开关改过 | `node dsh-plugins/install.mjs` 后重启 |

## 5.4 工作台里的 DSH 会话面板（2026-11-23）

- **干净克隆先装一次**：`外壳/node_modules`、`引擎/node_modules`、`引擎/.dsh` 都不进版本库，
  按工作台 README「首次安装」装完再 `start.cmd`（否则引擎起不来）。
- **平台也随工作台自启动**（2026-11-23 起）：主进程探 `http://127.0.0.1:8000/health`，没起就后台跑仓库根目录 `dev.cmd up`（WSL 常驻 + docker compose，幂等）；启动页显示平台进度，面板请求会等平台就绪；`AM_PLATFORM=0` 可关闭自动启动。
- **落地场景**：工作台总览（`overview`）；「DSH 会话」面板 `id=ov-chat`，`type: "harness"`，`sessionTitle: "工作台总览"`。
- **面板口径**：5 个场景 / 21 个面板 = 20 个原生渲染器 + 1 个 `harness` webview；总览的「DSH 会话」面板即 DSH 入口（原「DSH 大脑」面板已于 2026-11-23 删除）。
- **「DSH 引擎」场景标签保留**：引擎由工作台自己拉起（3083 已在监听时复用），是真实会话入口；启动落地仍是「工作台总览」。
- **版本徽标琥珀色是预期**：`外壳/renderer/renderers.js` 的 `ADAPTED_ENGINE` 记的是"已验证契约版本" `0.2.1-rc.3`，
  当前引擎是 `0.2.2-rc.5`，所以品牌区小点会变琥珀色并在 console 提示版本不一致——会话面板/三轨道布局正常时这是提示而非故障；
  升级契约（重新核对注入锚点）后再把这个常量一起改。
- **布局注入**：内嵌 DSH 是显式三列 grid，精简模式必须注入三轨道 `0px minmax(0, 1fr) 0px`（`main.js` 与 `renderers.js` 各一份）。写单轨道 `minmax(0,1fr)` 会生成隐式自动列，表现为「左侧栏收起时对话框偏右、输入文本越长越向左偏移」；2026-11-23 已修为三轨道。
- 复用外部 3083 实例时拿不到它的启动 token，面板可能显示未就绪；工作台自己拉起的实例会从 stdout 抓 token，面板可用。
- **新对话自动接项目进度**（2026-11-23）：profile 补丁层把 `dsh-web-app` 默认关掉的 `agent-instructions` 重新打开
  （`cordis.patch.yml` 里 `- id: agent-instructions` + `disabled: false`），每个新会话首次请求会加载仓库根
  `AGENTS.md`（开工顺序：读 `docs/HANDOFF.md` → 看 `git status/log` → 按任务读专题文档；另附当前基线与纪律）。
  它走的是项目链（根 `.git` 标记 + 会话工作区 = 项目根），用户级 `$DSH_HOME/AGENTS.md` 不需要放。

## 6. 当前边界：反向执行还没接，界面侧已经接入

**工作台 → DSH 的反向调用（把 Worker 接到 DSH 的 agent loop）仍未做**；但界面侧已经接入：总览的「DSH 会话」面板是真实的 `type=harness` webview，钉 `sessionTitle=工作台总览`（§5.4）。

「暂不接入」的旧结论已不成立。当前缺的不是 CLI 或接口：

1. `引擎/` 里的 DSH 包自带 CLI（`lib/bin.js`）、类型声明（`lib/types/*.d.ts`）、`src/` 与 `docs/`；
2. 本地 3083 服务需要 GUI 侧 token，接口是 typert RPC——这仍限制"直接调 HTTP"，但不影响插件链路；
3. 要让每次执行都走 DSH 的 agent 循环，仍需在**同一进程内**拿到 `ctx.agents` 并驱动会话，
   要求工作台本身以 Cordis 插件形式运行在 DSH 内；这属于 S4 阶段，不在该轮范围。

即：**DSH 目前是"可执行任务的前台 + 工作台内的真实会话面板"，尚未成为"被执行层调用的运行时"**。

## 7. 下一步与边界

原先"只有 `app.asar`、没有类型声明与文档"的阻塞已经解除：`引擎/node_modules/@deepseek-ai/dsh/` 自带 `lib/types/*.d.ts`、`src/` 与 `docs/`（`architecture.md`、`tool-catalog.md`、`agent-lifecycle.md` 等），CLI 也支持 `--help` / `--dump-config`。

剩下的工作：

1. **S1**：把 Worker 的 `LLMGateway` 换成"调用 DSH 智能体会话"（需要宿主侧 `ctx.agents`）；
2. **S2**：把领域技能注册为 DSH 技能/工具（当前稳定的是 4 个平台工具，见 §5）。

在 S1 跑通之前，**不建议**把执行器改成"凭猜测调 DSH"；当前稳定链路是 DSH → 工作台。

## 8. 并行推进的基础工作

- 真实数据接入：DataCo 65,752 单已接入（`supply_orders`）；M5 仍未接
- 工作台易用性与视觉：已完成设计系统、Schema 表单、筛选分页、异常优先
- 产业链调研：投入产出表法，见 `docs/industry-chain.md`
