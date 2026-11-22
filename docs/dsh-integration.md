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

## 5. 当前阻塞

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
