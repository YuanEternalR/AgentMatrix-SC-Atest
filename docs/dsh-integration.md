# DSH 集成方案（以 DSH 为运行时）

> 决策：工作台以 **DSH 作为智能体运行时**（agent / skill / session / LLM 都复用 DSH 能力），
> 我们的工作台负责编排、调度策略、审批、观测与界面。
> 本文记录实测到的 DSH 接口事实，以及可落地的增量路径。

## 1. 实测到的 DSH 结构

DSH 是 **Cordis 插件树**，当前 profile 加载了 200 个插件。与"运行时"直接相关的：

| 能力 | 插件包 | 对我们的意义 |
|---|---|---|
| 智能体循环 | `@deepseek-ai/dsh-agent` | 替代我们自研的"提示词组装 + 工具调用循环" |
| 技能/工具 | `@deepseek-ai/dsh-skill`、`dsh-tool-skill`、`dsh-skill-filesystem` | 技能的注册与发现机制（我们现在的 skill 注册表可映射过去） |
| 会话 | `dsh-session`、`dsh-session-persistence-jsonl`、`dsh-session-query-sqlite` | 对话与上下文持久化、可查询 |
| 模型 | `dsh-llm`、`dsh-llm-pi-ai`、`dsh-deepseek-llm-api-extensions`、`dsh-agent-default-model` | 真实模型调用、重试、默认模型 |
| 子智能体 | `dsh-subagent`、`dsh-subagent-spawn-in-process`、`dsh-subagent-fork-in-process` | 多智能体协作 |
| 工作流 | `dsh-workflow-ptc`、`dsh-tool-workflow` | 与我们 DAG 的关系需评估（是否二选一） |
| 可观测 | `dsh-token-meter`、`dsh-otel`、`dsh-session-telemetry-otel` | Token 计量与追踪，可直接替代我们的成本估算 |
| 沙箱/审批 | `dsh-sandbox-local`、`dsh-user-approval`、`dsh-permission-presets` | 工具执行隔离与人工审批 |
| API 网关 | `dsh-api-gateway`、`dsh-api-remote-access`、`dsh-typert-*` | 类型化 RPC，GUI 与后端之间的通道 |

## 2. 插件安装与配置方式

profile 位于 `C:\Users\<用户>\.dsh\profiles\desktop\`：

```
package.json        # dsh.profile.bundles 列出启用的 bundle
cordis.yml          # 空树，由 bundle 组合
cordis.patch.yml    # 覆盖层：按 id 覆盖配置 / 禁用 / 插入插件
```

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

- `http://127.0.0.1:65297` 有 HTTP 服务，但**所有路径返回 401**（需要 GUI 侧的鉴权令牌）。
- 没有 `/openapi.json`，接口是 `typert` 类型化 RPC，schema 不对外暴露。

**所以不能"直接调 HTTP"作为集成方式**，除非先拿到鉴权与接口定义。

## 4. 建议的集成路径（增量，不重写）

保留我们已验证的部分，只替换"最该由 DSH 承担"的那一层：

| 阶段 | 做什么 | 产出 | 风险 |
|---|---|---|---|
| **S1** | 把执行器的 `LLMGateway` 换成"调用 DSH 智能体会话" | 一次真实的 LLM 调用跑通工作流 | 需要知道会话调用接口 |
| S2 | 把我们 8 个内置技能注册为 DSH 技能/工具 | 智能体能通过 DSH 调用领域技能 | 需要技能注册 API |
| S3 | 用 `dsh-token-meter` 替换我们的成本估算 | 真实 token 与费用 | 低 |
| S4 | 用 `dsh-subagent` 实现"规划器派生子智能体执行" | 与论文的"大模型规划"更贴合 | 中 |
| S5 | 工作台改为调用 DSH 的会话查询做轨迹展示 | 观测数据同源 | 低 |

**不动的部分**：5 种调度策略、工作流 DAG 与校验、审批、重试/死信、告警、矩阵与可视化、UI。
这些是本课题的"系统亮点"和"研究点"，不应交给 DSH 代劳。

## 5. 已实现：DSH 工具连接器（v0.1）

在拿到官方插件教程后，已按 Cordis 规范实现并安装了一个 **bundle**：
`dsh-plugins/agentmatrix-tools/`

它把工作台的能力暴露成 DSH 工具，DSH 里的智能体可以直接调用：

| 工具 | 作用 | 返回 |
|---|---|---|
| `agentmatrix_create_task` | 在矩阵里发起任务 | 任务 ID、派给谁、策略、分数、前 3 个因子、被淘汰候选 |
| `agentmatrix_explain_dispatch` | 解释某次调度 | 全量因子（raw/weight/contribution）与淘汰原因 |
| `agentmatrix_run_status` | 查运行轨迹 | 状态、成本、Token、每节点状态与尝试次数 |
| `agentmatrix_matrix_coverage` | 看矩阵覆盖 | 覆盖率、缺口清单 |

**方向说明**：这是 **DSH → 工作台** 的方向——DSH 负责对话与规划，工作台负责领域执行与可观测。
它让"基于 DSH"从口号变成可演示的事实：在 DSH 里说一句话，就能建任务并拿回调度依据。

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

安装会：备份 `package.json`/`cordis.patch.yml` → 用 DSH 自带 pnpm 装 `file:` 依赖 → 把 bundle 名写入 `dsh.profile.bundles`。
**需要重启 DSH 才会加载**。

## 5.1 踩坑记录：schema 有三层规则，而且互相打架

插件从"加载失败"到"加载成功但调用失败"再到"可用"，踩了三个不同的坑：

| # | 现象 | 报错 | 原因与修正 |
|---|---|---|---|
| 1 | 插件 `fiberPhase: failed` | `parameters.payload.required must be true when present` | DSH 的 schema DSL 不接受 `required: false`。可选参数应**省略**该字段 |
| 2 | 仍 `failed` | `parameters.payload.additionalProperties must be explicitly true or false` | `type: 'object'` 的参数与输出**必须**显式声明 `additionalProperties` |
| 3 | 加载成功，但**每次对话处理失败** | `Invalid schema for function 'agentmatrix_create_task': {"type":"string","required":true,...} is not of type "string"` | DSH 把属性定义**原样**作为 JSON Schema 发给模型 API，而 `required: true` 写在单个属性里不是合法 JSON Schema（`required` 只能是父级的字符串数组） |

**结论：属性里一条 `required` 都不能留。** 但 DSH 自身的加载校验又会检查"如果写了 required，必须是 true"——
两条规则叠加后只剩一个安全写法：**完全不写 `required`**。

必填约束因此改为在 `execute` 里手动校验，抛出的错误会作为工具结果回给模型，模型据此补齐参数——
体验上仍然"模型自己会把参数补全"，只是校验位置从 schema 移到了代码里。

这三条都已写成 `test.mjs` 的断言（第 5、5.1、6、7 组），以后改 schema 会先在离线测试里失败。

**排查方式**：两个错误面要分开看——
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
总体覆盖：78.57%（28 格里覆盖 22 格，共 10 个智能体；当时为 7 阶段，现已调整为 6 阶段 24 格）
缺口 6 个：需求计划×感知与解析、需求计划×执行与协同、采购寻源×执行与协同、
          运输物流×分析与预测、合规风控×感知与解析、合规风控×执行与协同
```

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

## 6. 尚未实现的（为什么）

**工作台 → DSH 的反向调用（把我们的 Worker 接到 DSH 的 agent loop）还没做**，原因是：

1. 安装版没有 `dsh` CLI 入口（只有 Electron 主进程），无法用 `--patch` 或 `dsh plugin` 在运行时验证；
2. 本地 HTTP 服务（`127.0.0.1:65297`）需要 GUI 侧令牌，接口是 typert RPC，未公开；
3. 要做到"我们每次执行都走 DSH 的 agent 循环"，需要在**同一进程内**拿到 `ctx.agents` 并驱动它，
   这要求工作台本身以 Cordis 插件形式跑在 DSH 里——那是 S4 阶段的工作，不是本轮范围。

换句话说：**现在 DSH 是"能干活的前台"，还不是"被执行层调用的运行时"**。
这一步的路已经清楚（写成插件、用 `ctx.agents` 驱动会话），但需要更深的宿主集成，且必须重启验证。

## 7. 当前阻塞

要落地 S1/S2，必须知道 Cordis 插件的编程接口（`ctx.agent`、`ctx.skill`、`ctx.session` 等上下文方法签名）。
这些在安装目录里只有编译后的 `app.asar`（203MB），没有类型声明与文档。

**需要的授权（二选一）**：

1. 允许我解包 `app.asar`（只读，不修改安装）以反查插件 API 与调用约定；
2. 或提供 DSH 插件开发文档 / 示例插件。

在拿到接口之前，**不建议**动执行器代码——否则只能靠猜，做出来的"基于 DSH"是假的。

## 6. 在此之前可以并行做的事

- 真实数据接入（DataCo / M5），让业务事实从"编的"变成"真实的"
- 工作台易用性与视觉（已完成第一轮：设计系统、Schema 表单、筛选分页、异常优先）
- 产业链调研（投入产出表法）
