# AgentMatrix-SC 工作台（改造自 luanyujia-workbench 模板）

一套跑在本机的**场景化工作台**：5 个场景、22 个面板 = **21 个原生渲染器面板** + **1 个「DSH 会话」面板**
（`type: harness`，内嵌 DSH 引擎界面，是唯一允许有 webview 的面板；见下「与模板的对应关系」）。
除它以外所有面板都自己画、不嵌网页，数据来自同仓库的 AgentMatrix 平台（`apps/api` + `apps/web`）。

## 快速开始

```bat
cd agentmatrix-workbench
start.cmd
```

`start.cmd` 会自己把要用的都拉起来，**不需要先 `dev up`**：

- **引擎**：`工作台配置.ini` 的 `DSH_PORT=3083`。端口在监听就复用（日志 `reuse: port already listening`），
  没在跑就自己拉起 `引擎\node_modules\@deepseek-ai\dsh\lib\bin.js`（profile=`workbench`，`DSH_HOME=引擎\.dsh`）；
- **平台**：探 `http://127.0.0.1:8000/health`，没起就在仓库根目录后台跑 `dev.cmd up`（WSL 常驻 + docker compose），
  启动页显示「平台启动中…」→「平台已就绪」，面板请求会等它就绪再发；想关掉自动启动就 `set AM_PLATFORM=0`。

端口与账号：`工作台配置.ini`（DSH_PORT）、`外壳/main.js` 顶部（AM_API / AM_EMAIL / AM_PASSWORD）。
环境变量：`AM_PLATFORM=0`（关平台自启动）、`AM_DEBUG_PORT=9222`（开 CDP 调试端口）。

## 目录

```
外壳/                 Electron 主进程 + 渲染层（模板原版）
  main.js             开窗、代理 AgentMatrix API（am:get/post/put）、拉起/复用引擎、自启动平台
  preload.js          window.app（模板能力）+ window.am（我们的数据通道）
  renderer/
    renderers.js      模板自带的一堆渲染器（我们只用其中少数；harness 面板的注入常量在这里也有一份）
    am-panels.js      ★ 原生面板第一批：kpi/tasks/runs/audit/matrix/assistant + 导出工具
    am-panels2.js     ★ 第二批：approvals/deadletters/skills/agents/dispatch/alerts/workflows/dsh/account/chart
    am-panels3.js     ★ 第三批：designer（工作流设计器）、create（新建表单）
    retarget.js       ★ 领域改造补丁：收起顶栏无关入口、清面板按钮 emoji、启动落地（「DSH 引擎」场景保留）
    styles.css        模板样式 + 我们的 am-* 面板样式
  scenarios/          ★ 5 个场景 JSON（overview / designer / matrix / delivery / governance）+ 场景身份索引
  scripts/            启动器与自检（留 sessions/刷新面板/自检/sidebar/office2pdf）
工具/                 场景记忆、发消息、封装等记忆工具（模板原版）
引擎/                 DSH 引擎（npm 装的 @deepseek-ai/dsh，工作台自己拉起）
  .dsh/               工作台专用 DSH 家目录（profile=workbench，不进版本库）
引擎数据/.dsh/        场景记忆骨架（已换成我们的 5 个场景）
说明/                 使用说明 + 记忆约定
```

★ = 本次改造自己写的；其余为模板原版。

原生面板现状：**18 种渲染器类型、21 个面板**（`am-assistant` 在总览 / 工作流设计 / 能力矩阵 / 治理
各用一次），类型清单见模块内的注册行与 [`docs/workbench-template.md`](../docs/workbench-template.md) §20.6。

## 与模板的对应关系

- **照搬**：Electron 外壳、网格与面板机制、展开/收起、记忆方法论、样式体系；
- **改领域**：场景、面板内容、品牌、启动落地、CSP、静态服务目录；
- **沿用**：模板的 `harness` 面板机制 —— **总览里的「DSH 会话」面板（`ov-chat`）就是模板 harness 的真实启用**
  （`sessionTitle: 工作台总览` + `pinTarget`），不是隐藏也不是替代；模板自带的「DSH 引擎」场景标签也**保留**
  （引擎由工作台自己拉起、能抓到 token，它就是真实会话入口；启动仍落地 `overview`）；
- **新增**：`window.am` 数据通道、21 个原生面板（含「DSH 大脑」「账号」）、CSV/PNG 导出、场景助手页、工作流设计器。

详细记录见 [`docs/workbench-template.md`](../docs/workbench-template.md)。

## 已知边界

- **DSH 会话面板**：只有在复用**外部** DSH 实例时才拿不到 token（面板会显示未就绪）；
  默认走工作台自己拉起的引擎（`profile=workbench`），面板可用；
- **设计器**：节点摆位只在本次会话内有效（不写回 `graph`）——布局是视图的事，结构才是数据的事；
- **账号**：面板统一用开发者账号（`dev@agentmatrix.local`）。调度保存 / 工作流校验只接受 developer，
  审批接受 operator/developer，所以用一个 developer 账号覆盖全部写操作；
- **平台自启动**：依赖本机 WSL + docker，冷启动约 10–60 秒（启动页会显示
  「平台启动中…」→「平台已就绪 · 接口 8000 / 站点 5173」）；`AM_PLATFORM=0` 可关掉自动启动、只复用已在跑的平台；
- **模板遗产**：`renderers.js` 里 `pc-*` / `review-*` / `bl-*` / `site-*` / `webai` 等渲染器仍在（约 1MB），
  没有场景使用，留着备用。
