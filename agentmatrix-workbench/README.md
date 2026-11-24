# AgentMatrix-SC 工作台（改造自 luanyujia-workbench 模板）

一套跑在本机的**场景化工作台**：5 个场景、21 个面板 = **16 个原生渲染器面板** + **5 个「DSH 会话」面板**
（`type: harness`，每场景一个，内嵌 DSH 引擎界面，是唯一允许有 webview 的面板；见下「与模板的对应关系」）。
除它以外所有面板都自己画、不嵌网页，数据来自同仓库的 AgentMatrix 平台（`apps/api` + `apps/web`）。

## 首次安装（干净克隆，只做一次）

仓库只提交源码：`外壳/node_modules`（Electron）、`引擎/node_modules`（`@deepseek-ai/dsh`）、
`引擎/.dsh`（DSH 家目录与凭据）和仓库根 `.env` 都不在版本库。干净克隆后直接 `start.cmd`
会因缺 Electron / DSH 而失败，需先在**仓库根目录**按以下步骤安装：

```powershell
Copy-Item .env.example .env          # 平台配置；真实模型改成 LLM_PROVIDER=deepseek 并填 LLM_API_KEY

cd agentmatrix-workbench\外壳
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
npm install
node node_modules\electron\install.js

cd ..\引擎
npm install

cd ..\..
node agentmatrix-workbench\scripts\setup-dsh-home.cjs
```

- 需要 Node.js 24.9+（`外壳/package.json` 的 `engines`，`start.cmd` 也要求 `node` 在 PATH）；平台需要 WSL2 + Docker Engine，见根 README「方式二」与 [`docs/environment-setup.md`](../docs/environment-setup.md)。
- 第 3 步会复制本机 `~/.dsh/.credentials.yaml` 作模型凭据；没有就先按 DSH 官方方式登录一次（该凭据不进入版本库）。
- 插件安装依赖 pnpm：报「插件安装失败（可能没有 pnpm）」时执行
  `npm install -g --allow-scripts=pnpm pnpm`，再重跑第 3 步。
- 装完 `cd agentmatrix-workbench` 运行 `start.cmd`；以后启动不需要重复安装。
- **首次启动后再跑一次场景会话初始化**（引擎 3083 已起来时，另开一个终端）：
  `node agentmatrix-workbench\工具\场景会话.mjs ensure --seed`，然后点工作台右上角 ⟳ 刷新当前场景。
  它按标题重建 5 条 `场景 · <场景名>` 专属会话并回写场景 JSON；之后 id 稳定，不需要再跑。
  不跑也能用，但五个「DSH 会话」面板会停在欢迎页（找不到本机会话）。

## 快速开始

首次安装完成后，以后每次启动只要：

```bat
cd agentmatrix-workbench
start.cmd
```

`start.cmd` 会自己把要用的都拉起来，**不需要先 `dev up`**：

- **引擎**：`工作台配置.ini` 的 `DSH_PORT=3083`。端口在监听就复用（日志 `reuse: port already listening`），
  没在跑就自己拉起 `引擎\node_modules\@deepseek-ai\dsh\lib\bin.js`（profile=`workbench`，`DSH_HOME=引擎\.dsh`）；
- **平台**：探 `http://127.0.0.1:8000/health`，没起就在仓库根目录后台跑 `dev.cmd up`（WSL 常驻 + docker compose），
  启动页显示「平台启动中…」→「平台已就绪」，面板请求会等它就绪再发；关闭自动启动可 `set AM_PLATFORM=0`。

端口与账号：`工作台配置.ini`（DSH_PORT）、`外壳/main.js` 里的 AM_API / AM_EMAIL / AM_PASSWORD（均可被同名环境变量覆盖）。
环境变量：`AM_PLATFORM=0`（关平台自启动）、`AM_DEBUG_PORT=9222`（开 CDP 调试端口）。

新开的 DSH 对话会自动加载仓库根 `AGENTS.md`（见项目根），它要求先读 `docs/HANDOFF.md` 并同步当前基线；
这是 2026-11-23 重新启用 `agent-instructions` 后生效的（profile 配置在 `引擎/.dsh/profiles/workbench/cordis.patch.yml`，
`scripts/setup-dsh-home.cjs` 会同步写入，重建家目录不会丢）。

## 目录

```
外壳/                 Electron 主进程 + 渲染层（模板原版）
  main.js             开窗、代理 AgentMatrix API（am:get/post/put）、拉起/复用引擎、自启动平台
  preload.js          window.app（模板能力）+ window.am（本项目的数据通道）
  renderer/
    renderers.js      模板自带的一堆渲染器（仅使用其中少数；harness 面板的注入常量在这里也有一份）
    am-panels.js      自研 · 原生面板第一批：kpi/tasks/runs/audit/matrix/assistant + 导出工具
    am-panels2.js     自研 · 第二批：approvals/deadletters/skills/agents/dispatch/alerts/workflows/dsh/account/chart
    am-panels3.js     自研 · 第三批：designer（工作流设计器）、create（新建表单）
    retarget.js       自研 · 领域改造补丁：收起顶栏无关入口、清面板按钮 emoji、启动落地（「DSH 引擎」场景保留）
    styles.css        模板样式 + 本项目的 am-* 面板样式
  scenarios/          自研 · 5 个场景 JSON（overview / designer / matrix / delivery / governance）+ 场景身份索引
  scripts/            模板自带的会话/自检/导出脚本（sessions/刷新面板/自检/sidebar/office2pdf）
scripts/              自研 · 启动器 launch.cjs、场景布局/迁移脚本、setup-dsh-home.cjs（生成 DSH 家目录）
工具/                 场景记忆、发消息、封装等记忆工具（模板原版）
引擎/                 DSH 引擎（npm 装的 @deepseek-ai/dsh，工作台自己拉起）
  .dsh/               工作台专用 DSH 家目录（profile=workbench，不进版本库）
引擎数据/.dsh/        场景记忆骨架（已替换为本项目的 5 个场景）
说明/                 使用说明 + 记忆约定
```

星标表示本次改造自研；其余为模板原版。

原生面板现状：**18 种渲染器类型注册、16 种在用 / 16 个原生面板**（`am-assistant`、`am-dsh` 保留注册但已无场景使用），
类型清单见模块内的注册行与 [`docs/workbench-template.md`](../docs/workbench-template.md) §20.6。

## 与模板的对应关系

- **照搬**：Electron 外壳、网格与面板机制、展开/收起、记忆方法论、样式体系；
- **改领域**：场景、面板内容、品牌、启动落地、CSP、静态服务目录；
- **沿用**：模板的 `harness` 面板机制 —— **五个场景各一个「DSH 会话」面板**，各绑定自己的
  `场景 · <场景名>` 专属会话（`sessionTitle` + `sessionId` + `pinTarget`）；场景面板是**单会话模式**
  （不显示全局侧栏，只看得到本场景会话）；模板自带的「DSH 引擎」标签也**保留**，显示全局会话列表与完整侧栏，
  作为跨场景共同修改的协调入口（引擎由工作台自己拉起、能抓到 token；启动仍落地 `overview`）。
- **新增**：`window.am` 数据通道、16 个原生面板（含「账号」）、CSV/PNG 导出、工作流设计器。
- **删除**：总览的「DSH 大脑」面板（2026-11-23 按反馈移除；`am-dsh` 代码仍注册，暂无场景使用）；
  四个场景的「场景助手」（`am-assistant`）面板（2026-11-24 按反馈移除，AI 问答统一走每场景的「DSH 会话」；
  `am-assistant` 渲染器仍注册，要恢复只改场景 json）。

详细记录见 [`docs/workbench-template.md`](../docs/workbench-template.md)。

## 已知边界

- **DSH 会话面板**：只有在复用**外部** DSH 实例时才拿不到 token（面板会显示未就绪）；
  默认走工作台自己拉起的引擎（`profile=workbench`），面板可用；场景专属会话的 `sessionId` 是本机 id，
  换机器/清空 `引擎/.dsh` 后先跑 `node 工具\场景会话.mjs ensure --seed` 再重启工作台；
- **设计器**：节点摆位只在本次会话内有效（不写回 `graph`），布局仅在视图层生效，`graph` 只保存结构；
- **账号**：面板统一用开发者账号（`dev@agentmatrix.local`）。调度保存 / 工作流校验只接受 developer，
  审批接受 operator/developer，所以用一个 developer 账号覆盖全部写操作；
- **平台自启动**：依赖本机 WSL + docker，冷启动约 10–60 秒（启动页会显示
  「平台启动中…」→「平台已就绪 · 接口 8000 / 站点 5173」）；`AM_PLATFORM=0` 可关掉自动启动、只复用已在跑的平台；
- **模板遗产**：`renderers.js` 里 `pc-*` / `review-*` / `bl-*` / `site-*` / `webai` 等渲染器仍在（约 1MB），
  没有场景使用，留着备用。
