# AgentMatrix-SC 工作台（改造自 luanyujia-workbench 模板）

一套跑在本机的**场景化工作台**：5 个场景、19 个面板，全部是原生渲染器（不嵌网页），
数据来自同仓库的 AgentMatrix 平台（`apps/api` + `apps/web`）。

## 快速开始

```bat
:: 1) 起平台
cd agentmatrix-sc
dev up

:: 2) 起工作台
cd agentmatrix-workbench
start.cmd
```

端口与账号：`工作台配置.ini`（DSH_PORT）、`外壳/main.js` 顶部（AM_API / AM_EMAIL / AM_PASSWORD）。

## 目录

```
外壳/                 Electron 主进程 + 渲染层（模板原版）
  main.js             开窗、代理 AgentMatrix API（am:get/post/put）、引擎复用
  preload.js          window.app（模板能力）+ window.am（我们的数据通道）
  renderer/
    renderers.js      模板自带的 20 个渲染器（我们只用其中少数）
    am-panels.js      ★ 原生面板第一批：kpi/tasks/runs/audit/matrix/assistant + 导出工具
    am-panels2.js     ★ 第二批：approvals/deadletters/skills/agents/dispatch/alerts/workflows/chart
    am-panels3.js     ★ 第三批：designer（工作流设计器）、create（新建表单）
    retarget.js       ★ 领域改造补丁：隐藏引擎场景/顶栏无关入口、清面板按钮 emoji、启动落地
    styles.css        模板样式 + 我们的 am-* 面板样式
  scenarios/          ★ 5 个场景 JSON + 场景身份索引
  scripts/            启动器与自检（留 sessions/刷新面板/自检/sidebar/office2pdf）
工具/                 场景记忆、发消息、封装等记忆工具（模板原版）
引擎数据/.dsh/        场景记忆骨架（已换成我们的 5 个场景）
说明/                 使用说明 + 记忆约定
```

★ = 本次改造自己写的；其余为模板原版。

## 与模板的对应关系

- **照搬**：Electron 外壳、网格与面板机制、展开/收起、记忆方法论、样式体系；
- **改领域**：场景、面板内容、品牌、启动落地、CSP、静态服务目录；
- **替换**：模板的 `harness`（DSH 引擎会话）面板 → 我们的 `am-assistant`（`/workbench/ask`）；
- **新增**：`window.am` 数据通道、16 个原生面板、CSV/PNG 导出、场景助手页、工作流设计器。

详细记录见 [`docs/workbench-template.md`](../docs/workbench-template.md)。

## 已知边界

- 复用外部 DSH 实例拿不到 token，模板自带的 `harness` 面板不可用（已隐藏，改用原生助手）；
- 设计器的节点摆位只在本次会话内有效（不写回 `graph`）；
- 面板统一用开发者账号（调度保存/工作流校验只接受 developer）。
