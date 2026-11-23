# 工作台：改用成熟模板 + 换领域（2026-11-23 第二次重做）

> 前两版是我自己写的壳（`agentmatrix-shell/`）。用户否掉了它，理由一句话：
> **"这只是一种外观的仿照而已"** —— 自己搭的壳只学到了皮，交互、密度、面板能力都要从头造。
> 于是改为：**直接拿一套成熟的工作台模板（MIT），把它的领域换成我们的**。
> 代码在 [`agentmatrix-workbench/`](../agentmatrix-workbench/)。

## 1. 换成了什么

| | 前两版（已删） | 现在 |
|---|---|---|
| 来源 | 我自己写的渲染层（约 900 行） | [`luanyujia-workbench`](../../luanyujia-workbench-main/) 的公开模板（`12-源码照搬`） |
| 面板类型 | 5 种（view/status/memory/chat/links） | 模板自带 20+ 种（`harness` / `embed` / `file` / `chart` / …），且带标题栏工具、展开、自刷新、拖拽分屏 |
| AI | 我自己拼的 `/workbench/ask` | 模板的 `harness` 面板：**每个场景一个 DSH 会话**，靠 `sessionTitle` 钉住 |
| 记忆 | 我的 `memory/*.md` | 模板的 `引擎数据/.dsh/场景记忆/<场景>/`（含 §〇 交接、归档、跨场景留言工具） |
| 启动 | 我写的 Electron 壳 | 模板的 `main.js`（4896 行，含引擎复用、保活入口、崩溃保护、端口自愈） |

**结论**：外观不是仿出来的，是直接用了同一套代码；我们只改"领域"。

## 2. 领域替换清单（改了哪些）

| 位置 | 原来（模板作者的领域） | 现在（我们的） |
|---|---|---|
| 场景 | 命令 / B站 / 自我复盘 / 本地电脑 | 工作台总览 / 能力矩阵 / 交付追踪 / 治理与策略 |
| 场景面板 | 神经元视图、B站网页、文件库、磁盘清理 | 我们的页面（`/`、`/matrix`、`/runs`、`/audit`、`/settings/dispatch`、`/skills`、`/monitor`）+ 每场景一个 AI 会话 |
| 品牌 | DSH 引擎 · 淋雨家的工作台 | AgentMatrix-SC · 供应链智能体矩阵 |
| 静态服务 | 个人站 + Blender 实时画面 | 保留服务但不使用（`SITE_DIR` 指到本仓库目录） |
| 顶栏入口 | 豆包 / 通义 / 智谱 / Kimi / 市场 / 捐赠 / 个人站 | 用 `renderer/retarget.js` 收起（不动模板代码，可随时恢复） |
| 启动器 | `启动.vbs`（固定 3083 + 自带引擎目录） | `start.cmd`（纯 ASCII）→ `scripts/launch.cjs`，端口从 `工作台配置.ini` 读 |
| 登录态 | 无（模板没有这个概念） | 面板 URL 带 `embed=1&theme=dark&as=ops`，主站据此自动用演示账号登录 |

## 3. 关键取舍：不自己起引擎，复用正在跑的 DSH（第十二轮已改，见 §16）

> **⏳ 已过期（2026-11-23 校注）**：本节是第三轮当时的取舍。装了独立引擎以后（§16），工作台两条路都会走：
> `DSH_PORT`（现在是 **3083**）在监听就复用（日志 `reuse: port already listening`），
> 没在跑就自己拉起 `引擎\node_modules\@deepseek-ai\dsh\lib\bin.js`（profile=`workbench`，`DSH_HOME=引擎/.dsh`）。
> 所以「工作台不自己起引擎」「harness 永远未就绪」这两条都已不成立；下面保留原始记录。

模板启动时有两步：先探测 `DSH_PORT`，**端口已在监听就直接复用**（`engineIsForeign = true`），
否则才去 spawn `引擎\apps\cli\lib\bin.js`。

本机没有可用的 `引擎\` 目录（DSH 是打包进 `app.asar` 的安装版，没有 `apps/cli`）——**这条到第十二轮已不成立**，
独立引擎已经装进 `引擎\`（§16）。当时的做法是：

```
工作台配置.ini 里把 DSH_PORT 指到正在运行的 DSH Web GUI（当时是 58360；第十二轮已改回 3083，见 §16.2）
        ↓
main.js 探测到端口在监听 → 直接复用，0.2s 进入界面
        ↓
主界面走模板的保活入口 http://127.0.0.1:31238/chat（token 每次实时转发）
```

实测日志：

```
reuse: port already listening
[engine] 复用外部引擎 ⇒ 主界面走保活入口 http://127.0.0.1:31238/chat
[boot] 引擎就绪总耗时 0.2s
[boot] 窗口可见耗时 568ms
```

**代价**：复用外部引擎时，模板拿不到它的启动 token，所以 `harness`（AI 会话）面板会显示
「引擎还没就绪」。想让 AI 面板真正可用，只有两条路：
1. 装一份独立的 DSH 引擎到 `引擎\`（模板自带 spawn 路径，`引擎\apps\cli\lib\bin.js` 存在即生效）；
2. 或者让模板拿到 token（需要改 `main.js` 的取 token 逻辑，属于改模板核心，暂不做）。

> **后来怎么解决的**：第十二轮选了第 1 条（装一份独立引擎到 `引擎\`，§16），总览的 `harness` 面板
> 因此真正可用（§20）；只有「复用外部实例」时才会拿不到 token。

内容面板（`embed`）不受影响——它们嵌的是我们自己的站点，已经在跑。

## 4. 登录态怎么解决

模板的 `webview` 与我们的站点不同源，读不到 localStorage；每个面板手输账号没有意义。
做法是在主站（`apps/web/src/auth.tsx`）加一条**只在 embed 模式下生效**的演示登录：

```
http://127.0.0.1:5173/runs?embed=1&theme=dark&as=ops
                                       ↑        ↑
                                     隐藏导航   自动用演示账号登录
```

- 只认 `embed=1`；正常访问站点仍然是登录页；
- `as` 只能是演示账号（`ops`/`dev`/`admin`/`viewer`），密码写死为演示密码；
- 本地演示壳，不对外暴露。上线要改成签名 token。

## 5. 编码相关的坑（都已按 HANDOFF 第 0 条准则处理）

| 文件 | 坑 | 处理 |
|---|---|---|
| `scenarios/*.json` | PowerShell 写文件带 BOM，`JSON.parse` 直接拒绝，场景被静默跳过 | 存 UTF-8 **无 BOM** |
| `start.cmd` | 写了中文路径/提示，cmd 按 GBK 解析 UTF-8，整份脚本被拆成乱码命令 | **纯 ASCII**，逻辑搬到 `scripts/launch.cjs` |
| `启动.vbs` | UTF-8 中文把语句拆坏（"缺少语句"） | 直接弃用 VBS，改用 `.cmd` + Node |

## 6. 怎么启动

```bat
:: 1) 平台（2026-11-23 起这一步可以省：start.cmd 会自己探 /health 并跑 dev.cmd up，见 §20.4）
cd agentmatrix-sc
dev up
dev ps                 :: 五个容器都在运行（api/postgres/redis healthy，web/worker Up）

:: 2) 工作台
cd agentmatrix-workbench
start.cmd              :: 端口在监听就复用 DSH_PORT 那个实例；没在跑就自己拉起引擎

:: 3) 需要自动化/截图时
set AM_DEBUG_PORT=9222
start.cmd              :: 之后可用 CDP 连 127.0.0.1:9222
```

## 7. 已知边界

1. ~~`harness` 面板在复用模式下显示「引擎还没就绪」（见 §3）~~ → 第十二轮起工作台自己拉起引擎，
   总览的「DSH 会话」面板真实可用（§16、§20）；只有复用外部实例时才拿不到 token；
2. 模板自带的 `pc-*` / `review-*` / `neuron` 等渲染器还在代码里（约 1MB），只是没有场景使用——
   留着是为了以后要用时能直接加场景，不删；
3. 模板顶栏还有"文件夹""工具""插件"等入口，属于模板能力，保留；
4. 我们自己的 `agentmatrix-shell/` 已删除（git 历史里可查），避免两套壳并存。

## 8. 第三轮：AI 面板真连通 + 面板宽度 + 去掉 emoji

### 8.1 AI 面板：换成我们自己的场景助手页

模板的 `harness` 面板要两样东西：`引擎\apps\cli`（本机是打包安装，没有）和引擎启动时打印的
**token**（复用运行中的实例时拿不到，直接访问 401）。两条路都堵死，于是换成我们自己的页面：

```
/assistant?embed=1&theme=dark&as=ops&scene=delivery
```

- 后端用已有的 `POST /workbench/ask`：**场景 + 问题 → 实时快照 + 模型结论**；
- 页面顶部先把快照念一遍（待审批 / 24h 成功 / 矩阵覆盖 / 当前策略），用户一眼知道助手在看什么；
- 回答下面带 token 与成本，和平台其他地方口径一致。

无头浏览器实测（同 URL、同后端）：

```
facts = 待审批 2 · 24h 成功 32 · 失败 1 · 矩阵覆盖 26/32（缺口 6）· 策略 加权打分
answer = ① 现状：24 小时内运行 32 成功、2 待审批、1 失败…… ② 判断：最近失败的是运行 3552cf54，
         错误码 TRANSIENT（瞬时性故障）…… 快照里没有更细的失败原因字段，无法进一步定位
meta  = deepseek/deepseek-flash · 851 tokens · $0.000494 · 2735ms
```

注意最后一句：**快照里没有的信息它会直接说没有**，这就是提示词里写死的规矩。

### 8.2 面板宽度：350px 会被裁，716px 正常

模板用 `<webview>` 嵌页面。本机显示缩放 170%，实测：

| 面板宽度 | 结果 |
|---|---|
| 350px（4 列布局的 1 格） | 内容右侧被裁掉（guest 按设备像素布局，没有横向滚动） |
| 716px（4 列布局的 2 格） | 完整显示 |

所以把四个场景都改成**一宽 + 一助手**两栏（`w: 2` + `w: 2`）：
左边该场景的主视图，右边场景助手。信息密度降了，但没有一处在裁字。
（这是 webview 在高 DPI 下的固有行为，不是我们的 CSS 能修的。）

### 8.3 面板标题栏按钮去掉 emoji

模板的按钮是 `⛔ 取消内置 / 🔄 刷新 / 🌐 浏览器打开`，图标风格和这套深色细线界面不搭。
`renderer/retarget.js` 里用 MutationObserver 在面板出现后把前缀图标去掉（只改文字，不动事件），
现在显示为 `取消内置 / 刷新 / 浏览器打开`。

### 8.4 嵌入模式下的布局规则

我们的页面原本按整页设计（`.content` 有 `max-width: 1320px`、表格按宽屏排）。
主站在 `?embed=1` 时给 `<html>` 打 `data-embed`，样式表里对应放宽：

- `.content` 去掉最大宽度与整页内边距；
- `.grid-4` 改成 `auto-fit, minmax(130px, 1fr)`；
- 表格放进卡片，卡片自己横向滚动（**不要**给 table 设 `min-width`，那只会让页面整体溢出）。
## 9. 第四轮：面板必须自己完成功能（去掉全部浏览器嵌入）

用户的要求很明确：**"我要的是这个面板独自地完成功能，而不是调用浏览器间接显示"**。
于是把 `embed` 面板全部换掉，改为在模板里注册**原生渲染器**——面板自己画表格、自己做筛选、
自己发起请求，代码里没有 `<webview>`，也没有 `<iframe>`。

### 9.1 怎么做（三层，都在模板自己的机制里）

```
renderer/am-panels.js        ← 注册 renderers['am-kpi'] 等 6 个原生面板
        │ window.am.get/post（preload 暴露）
main.js                      ← 代理 AgentMatrix API：登录一次拿 JWT，401 自动重登
        │ fetch http://127.0.0.1:8000/api/v1/...
AgentMatrix 后端              ← 真实数据
```

- **不把 token 交给渲染层**：登录在 main.js 里做，渲染层只能调 `am.get/am.post`；
- **面板用模板的变量画**（`--bg-panel` / `--border` / `--text-dim` / `--accent` / `--ok` / `--err`），
  所以和外壳是同一套观感，没有"套娃"的阴影与圆角；
- **加面板 = 加一个函数**，与模板原有 20 个渲染器完全同构。

### 9.2 六个原生面板

| 类型 | 面板 | 关键交互 |
|---|---|---|
| `am-kpi` | 场景快照 | 待审批/24h 成功/失败/积压 + 覆盖率条 + 策略名（中文），15 秒自刷新 |
| `am-tasks` | 任务 | 状态筛选（全部/待审批/失败/已完成）、点行展开业务参数与所需能力 |
| `am-runs` | 运行监控 | 20 秒刷新、点行展开运行明细并**再拉一次详情**显示步骤轨迹 |
| `am-audit` | 审计日志 | 动作下拉筛选（选项来自 `/audit-logs/summary`）、点行看变更前后 |
| `am-matrix` | 能力矩阵 | 8×4 原生网格：有智能体显示数量、空的标「缺」并虚线描红；列出优先要补的格子 |
| `am-assistant` | 场景助手 | 建议问题 + 输入框 → `POST /workbench/ask`，显示 token 与成本 |

场景（4 列网格）：

```
工作台总览：场景快照(1×2) + 任务(3×2) / 场景助手(4×2)
能力矩阵  ：能力矩阵(3×4) + 场景助手(1×4)
交付追踪  ：运行监控(3×4) + 场景助手(1×4)
治理与策略：审计日志(3×4) + 场景助手(1×4)
```

### 9.3 回归：把"不许嵌网页"写成断言

`tests/e2e/workbench.mjs` 自己拉起 Electron（`--remote-debugging-port`）+ CDP 连进去，7 步：

```
✅ 01 四个场景标签都在
✅ 02~05 每个场景：面板标题齐全、正文有真实数据、**面板内 webview/iframe 数量必须为 0**
✅ 06 场景助手真的回答（deepseek-flash · 961 tokens · $0.00061 · 3264ms）
✅ 07 无渲染层报错
```

第 02~05 步的断言是直接对着用户这条要求写的：谁要是哪天图省事把面板换成 `embed`，
这条测试立刻红。

### 9.4 又踩一个坑：preload 里 `require` 之前不能用 `contextBridge`

第一版把 `contextBridge.exposeInMainWorld('am', …)` 写在了
`const { contextBridge } = require('electron')` **之前**，整个 preload 直接抛错，
连带 `window.app` 也没了 —— 表现是**所有场景面板全空**（连模板自带的都空）。
preload 跑在 Node 环境里，语句顺序就是执行顺序：先 require，再 expose。
## 10. 第五轮：功能补齐（16 个原生面板，全部可操作）

上一轮只有 6 个面板，缺的都是"能改数据"的部分。这一轮补齐到 **16 个原生面板**
（后面又加到 **21 个原生面板 + 1 个 DSH 会话面板**，现状见 §20.6），
平台侧的功能在工作台里基本都能闭环（查看 → 操作 → 留痕）。

### 10.1 面板清单

| 场景 | 面板 | 类型 | 能做什么 |
|---|---|---|---|
| 工作台总览 | 场景快照 | `am-kpi` | 待审批/成功/失败/积压/覆盖率/策略，15 秒自刷新 |
| | 待审批 | `am-approvals` | **填意见 → 通过 / 驳回**，20 秒自刷新 |
| | 任务 | `am-tasks` | 状态筛选、点行展开业务参数与所需能力 |
| | 场景助手 | `am-assistant` | 提问 → 真实模型 + 实时快照 |
| 能力矩阵 | 能力矩阵 | `am-matrix` | 8×4 网格，空的标"缺"，列出优先补的格 |
| | 智能体 | `am-agents` | **在线测试**（真实调用，出 token/成本/结论） |
| | 技能库 | `am-skills` | **试运行**（内置函数 + HTTP，出返回体） |
| | 场景助手 | `am-assistant` | 问缺口怎么补 |
| 交付追踪 | 运行监控 | `am-runs` | 点行展开明细并**再拉详情**画步骤轨迹 |
| | 运行趋势 | `am-chart` | 原生 SVG 按小时柱状，失败的小时标红 |
| | 死信队列 | `am-deadletters` | **重试 / 忽略** |
| 治理与策略 | 调度策略 | `am-dispatch` | 改策略与六因子权重 → **试算 → 保存 → 恢复默认** |
| | 审计日志 | `am-audit` | 动作筛选、点行看变更前后 |
| | 工作流 | `am-workflows` | **校验**（发真实 graph，出问题清单） |
| | 告警 | `am-alerts` | **确认 / 恢复** |
| | 场景助手 | `am-assistant` | 问治理相关的事 |

### 10.2 账号：默认开发者

写操作的角色要求不一致（审批接受 operator/developer，调度保存与工作流校验只接受 developer），
所以 `main.js` 的默认账号改成 `dev@agentmatrix.local`——**一个账号覆盖全部操作**。
要换账号：环境变量 `AM_EMAIL` / `AM_PASSWORD`，或改 `main.js` 顶部默认值。

### 10.3 回归扩到 8 步

```
✅ 01 四个场景标签都在
✅ 02~05 每场景：面板标题齐全、有真实数据、**webview/iframe = 0**、有可操作按钮
✅ 06 调度试算（fulfillment-triage · 总分 0.887 · 淘汰 29 个候选）与工作流校验（通过，0 问题）
✅ 07 场景助手真回答（deepseek-flash · 775 tokens · $0.00040 · 2116ms）
✅ 08 无渲染层报错
```

### 10.4 这一轮踩的坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 试算显示"无候选" | 接口返回字段是 `chosen`/`score`，我读了 `agent_name` | 按真实字段读，并显示淘汰候选数 |
| 工作流校验报 `[object Object]` | 422 的 `detail` 是对象，`String()` 变成 `[object Object]` | 主进程里对非字符串 `detail` 做 `JSON.stringify` |
| 校验一直失败 | 接口要的是 `{graph:{entry,nodes}}`，我传了 `{nodes,edges}`（详情里节点在 `graph` 里） | 先取详情，再把它 `graph` 原样送去校验 |
| 治理场景助手面板点不到按钮 | 面板只占 1 行（约 120px），提示条被裁 | 面板加到 2 行；回归改成用输入框提问 |
## 11. 第六轮：设计器、新建表单、导出（收口）

### 11.1 工作流设计器（`am-designer`）

第 5 个场景「工作流设计」，面板自己完成编辑，不依赖任何外部编辑器：

- **画图**：读 `/workflows/{code}` 的 `graph`，按 `next`/`on_true`/`on_false` 做分层布局；
  节点是绝对定位卡片（按类型着色：开始绿 / 条件黄 / 审批红 / 智能体蓝），连线是 SVG 折线，
  `on_false` 用红虚线区分；
- **改图**：拖动节点摆位；点节点打开行内编辑器，可改类型、技能编码、智能体、条件表达式、
  审批角色、`next`、`input_from`；可加节点、删节点；
- **校验**：把当前图发给 `POST /workflows/{code}/validate`，就地显示通过/错误/警告；
- **发布**：`POST /workflows/{code}/versions`（带 changelog），角标从「未发布」变「已同步」；
- 顶部可在多个工作流之间切换。

设计器里改的是"图"，摆位只影响本地显示（不写回 `graph`）——这是刻意的：
**布局是视图的事，结构才是数据的事**。

### 11.2 新建表单（`am-create`）

一个面板、三个页签（任务 / 技能 / 智能体），字段驱动：

| 页签 | 字段 | 提交 |
|---|---|---|
| 任务 | 标题、工作流（必选）、优先级、复杂度、所需能力、订单号 | `POST /tasks`（订单号进 `payload`） |
| 技能 | 编码、名称、分类、类型（内置/HTTP）、说明、函数名或接口地址 | `POST /skills`（按类型组 `builtin`/`http`） |
| 智能体 | 编码、名称、描述、阶段、模型档位、能力标签 | `POST /agents` |

按钮文案按页签区分（创建任务/创建技能/创建智能体）——同名按钮在同一面板里会误点。

### 11.3 导出

| 面板 | 导出 |
|---|---|
| 任务 / 运行 / 审计 / 死信 / 技能 / 智能体 / 工作流 / 告警 | **CSV**（带 BOM，Excel 直开不乱码） |
| 运行趋势 | **CSV**（按小时）+ **PNG**（SVG → canvas → blob，不引第三方库） |

实现都在 `am-panels.js` 的 `toCsv / csvButton / exportSvgAsPng`，表格通过第 4 个参数
`{ filename }` 挂上导出条。

### 11.4 回归扩到 12 步

```
✅ 01 五个场景标签都在
✅ 02~06 每场景：面板齐全、有真实数据、webview/iframe = 0、有可操作按钮
✅ 07 设计器：8 节点 / 8 连线 · 校验通过（0 错误 0 警告）
✅ 08 新建面板：真的创建一个任务（创建成功：工作台自检任务 …）
✅ 09 导出入口存在
✅ 10 调度试算（fulfillment-triage·0.887·淘汰 29 个）+ 工作流校验（通过·0 问题）
✅ 11 场景助手真回答（deepseek-flash·793 tokens·$0.00042·3320ms）
✅ 12 无渲染层报错
```

### 11.5 这一轮踩的坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 创建任务 422 `workflow_code Field required` | 我给了「不指定」空选项 | 工作流改为必选，默认订单延迟闭环 |
| `priority` 传成字符串 | 数字输入框被建成了 `type=text` | `field()` 支持 `type: 'number'`，提交前再 `Number()` |
| 点「创建」点到智能体页签 | 三个页签按钮同名 | 文案区分（创建任务/创建技能/创建智能体） |
| 回归第 10 步点到了「导出 CSV」 | 导出条插在表格前，是面板里第一个 `.am-act` | 测试按文案精确点 |
## 12. 第七轮：用户报的 5 个问题（逐个修复 + 回归钉住）

| # | 用户描述 | 根因 | 修法 |
|---|---|---|---|
| 1 | DSH 引擎一直显示没就绪，是干什么的 | 那是模板自带的「DSH 引擎」场景（它家 AI 会话用），我们复用外部引擎拿不到 token，所以永远"未就绪" | `retarget.js` 隐藏该场景标签 + 状态条 +「刷新对话」；我们的 AI 面板是原生助手，不依赖引擎（**后来改为保留该场景标签**，见 §13.1、§20） |
| 2a | 运行条目点了下面不显示信息 | 先 `show()` 概要、再 `show()` 步骤，第二次把概要覆盖了 | 抽屉增加 `append()`，步骤改为**追加** |
| 2b | 点「收起」后再点别的条目显示错误 | 收起时 `box.innerHTML=''` 把 `.am-drawer-body` 一起删了，之后 `show()` 往脱离文档的节点写 | 收起只隐藏 + 清空 body，容器保留 |
| 2c | 趋势图坐标轴与信息不全 | `viewBox 0 0 100 34` 太小、只画了 3 个文字标签、接口 `limit=300` 超上限（≤200）直接报错 | 重画：240×90 视口、纵轴 0/半/满刻度 + 横向网格、横轴每 6 小时刻度、柱高最小 1.5px；limit 改 200 |
| 3a | 下拉框白底白字看不清 | 原生 `<option>` 没继承主题色 | `select { color-scheme: dark }` + `option { background:#131722; color:#e6e8ee }` |
| 3b | 选哪个工作流都还是同一个 | 下拉只在首次加载时插入，任何重绘都被清空；且 `load()` 用 `meta.workflow || rows[0]` 覆盖了用户选择 | 下拉在 `draw()` 里每次重建；`load()` 优先用 `state_.code` |
| 3c | 设计器看不懂、太复杂 | 横向分层在窄面板里一路向右溢出 | 改**纵向**流程图（层=深度）、节点加大、加颜色图例 |
| 4 | 能力矩阵所有格子都标红"缺" | 接口里 `stages`/`categories` 的字段是 `code`，我读了 `stage`/`category` → 键对不上，全部落到"缺口"分支 | 改用 `st.code` / `cat.code` 组键（实测 32 格：26 有智能体、6 缺口） |
| 5 | 新建任务/技能失败（422 英文报错） | 必填项没填就直接提交，接口返回 pydantic 的英文错误 | 提交前做**中文必填校验**（"还差这些必填项：任务标题"），必填字段标 `*` |

### 12.1 回归钉住的行为（17 步）

新增 5 步，正好对应上面 5 个问题：

```
✅ 07 矩阵按真实数据渲染：32 格 → 有智能体 26 / 缺口 6
✅ 08 运行详情：点开有明细 → 收起 → 再点另一条仍有明细（且两条内容不同）
✅ 09 趋势图：24 根柱 / 8 个刻度 / 3 条网格
✅ 10 新建表单：必填为空时给中文提示
✅ 11 设计器：切换工作流后标题与节点真的变（fulfillment_review → order_delay_exception）
```

### 12.2 顺手修掉的

- 设计器连线标签引用了已删除的变量 `mx`，导致整块渲染失败（"加载失败：mx is not defined"）；
- 回归里 `page.waitForSelector('.tab')` 会命中被隐藏的引擎标签 → 改成等 `:visible`；
- 试算结果字段按接口真实返回读（`chosen`/`score`/`rejected`）。
## 13. 第八轮：刷新掉面板、启动落在引擎页、设计器连线

| # | 用户描述 | 根因 | 修法 |
|---|---|---|---|
| 1 | 点「刷新当前场景」后一堆「未知面板类型」 | 模板的刷新会**重新注入 renderers.js**，脚本顶部 `var renderers = {}` 造了个新对象，末尾再赋给 `window.APP_RENDERERS`；我们注册在旧对象上 → 换表后全丢 | 三个面板文件改注册到稳定对象 `window.__amPanels`；把 `window.APP_RENDERERS` 改成**访问器**，任何赋值都自动回填；每个文件注册完调 `window.__amSync()` |
| 2 | 进工作台第一个界面还是「DSH 引擎未加载」 | 模板的 `renderer/customer-start.js` 里写死 `var FIRST = 'command'`（原作者的首场景）。我们没有 `command`，它回退到 `all[0]` = 引擎场景 | `FIRST = 'overview'`（工作台总览） |
| 3 | 设计器连线显示错误 | ① 用写死的 `a.y + 52` 当卡片高度；② SVG 的 `viewBox` 用内容尺寸（396×677）却被 CSS 拉伸到整个画布宽度 → 坐标横向放大 3 倍，线全跑到卡片右边 | ① 节点插完**下一帧**量 `offsetLeft/Top/Width/Height`；② `viewBox` 改成画布真实像素（`clientWidth × 内容高`），1 单位 = 1px；末端加箭头，条件是/否标在线上 |

### 13.1 关于「DSH 引擎」那个场景（回答提问）

> **⏳ 已过期（第十二轮起，2026-11-23 校注）**：独立引擎已经装好（§16），`harness` 面板不再是"永远未就绪"——
> 总览里就有「DSH 会话」面板（§20）。而且**「DSH 引擎」这个整场景的标签后来改为保留**：引擎由工作台
> 自己拉起、能抓到 token，它就是真实的 DSH 会话入口（`retarget.js` 里"没就绪就隐藏"那段因为标签上没有
> `data-am-hide-when-down="1"` 而实际不生效）。下面这段是第八轮当时的状态。

它是模板自带的**引擎主界面**：原作者用它自己的 DSH 会话来当"每个场景一个 AI"。
我们的做法不同——AI 面板是原生助手（`/workbench/ask`），不依赖那个引擎。

**为什么不做成启动它**：模板要启动引擎必须满足两条之一：
① 本地有 `引擎\apps\cli\lib\bin.js`（本机是打包安装的 DSH，没有这个目录）；
② 复用已在运行的实例——但复用拿不到它的启动 token（`?token=`），面板只会显示"未就绪"。
所以隐藏它比留一个永远失败的页面更诚实；等以后装一份独立引擎目录，把 `retarget.js` 里的
`hideEngineBits()` 去掉即可恢复。

### 13.2 回归扩到 18 步（现在仍是 18 步，见 §20.5）

新增两步钉住本轮问题：

```
✅ 01 启动落地 overview（引擎标签已隐藏）—— 之前的「引擎页」问题
✅ 07 点「刷新当前场景」后：5 个面板、注册表 16 个原生类型、0 个「未知面板类型」
```

> **后来改为保留**：工作台自己拉起引擎、能抓到 token 以后（§16）引擎标签就不再隐藏了
> （上面第 01 步的"引擎标签已隐藏"是当时的状态）；现在的第 01 步断言的是
> "启动落地 `overview` + 「DSH 引擎」标签**在**"，见 §13.1、§20.5。

### 13.3 教训

- **热重载会换对象**：任何往第三方注册表里塞东西的实现，都要考虑"表被换掉"的情况，
  否则用户点一次刷新就还原成原始状态；
- **坐标要对齐两套坐标系**：SVG 的 `viewBox` 单位 ≠ 页面像素，除非严格相等；
  测量必须等布局完成（`requestAnimationFrame`），否则拿到 0。
## 14. 第九轮：连线对齐、模板规范对照、清理冗余

### 14.1 设计器连线为什么"和方块分离"

两个坐标问题叠在一起：

1. 节点卡片的 `offsetTop` 是**内容坐标**（可滚动画布内的绝对位置），
   而 SVG 用的是 `clientWidth/clientHeight`（**可视区**尺寸）+ `inset: 0` ——
   超出第一屏的节点，它的线被画到了视图外面；
2. 画布可滚动时 `viewBox` 与内容尺寸不一致，缩放后线与方块错位。

修法：SVG 的 `width/height` 直接设成**内容尺寸**（`max(可视宽, 最右节点) × max(可视高, 最下节点)`），
`viewBox` 与像素 1:1；CSS 改成 `left/top: 0; width/height: auto`（不再 100% 拉伸）；
拖动时用 `requestAnimationFrame` 节流重画，箭头跟着方块走；箭头方向按最后一段判断（目标在上就朝上）。

验证脚本（实测）：8 张卡片 / 8 条连线 / **8 条端点全部落在卡片底边中点与目标顶边中点**（误差 < 1.5px），
画布内容高 661 > 可视高 552 —— 修之前正是这 109px 里的节点丢了连线。

### 14.2 模板规范对照

模板的《场景配置格式》要求：

| 规范 | 我们的情况 |
|---|---|
| `scenarios/<id>.json`，**文件名必须等于 id** | ✅ 5 个场景全对 |
| 必填：`id` / `name` / `panels[]`（每个面板 `id`/`title`/`type`） | ✅ |
| `layout: "grid"`、`theme: "dark"` | ✅ |
| 面板坐标不得超出 `cols`（否则网格长出隐式列、比例乱） | ✅ 5 个场景最大用到第 4 列 |
| 面板类型必须已注册到 `APP_RENDERERS` | ✅ 18 个原生类型 / 21 个原生面板全部注册（脚本校验） |
| 面板自刷新要有 cleanup | ✅ 我们的 `am-kpi/runs/approvals/alerts/chart/deadletters` 都 `return () => clearInterval(...)` |
| 场景 JSON 不带 BOM | ✅ 校验脚本会报 |
| `_场景身份索引.md` 与场景同步 | ✅ 已重写为我们的 5 个场景 |
| 场景记忆在 `引擎数据\.dsh\场景记忆\<场景>\`（§〇 交接 ≤4KB） | ✅ 已换成我们的 5 个场景骨架 |

**有意偏离的一条（第十二轮起已部分回归）**：模板给 AI 面板配的是 `harness`（钉 DSH 会话），当时需要 `引擎\` 目录与引擎 token，
本机两者都拿不到。我们换成 `am-assistant`（原生助手，走 `/workbench/ask`）——
功能等价且不依赖引擎；代价是**没有"会话"概念**，所以场景记忆不再自动喂给助手
（助手读的是后端实时快照）。后来独立引擎装好了（§16），总览里已经用上真 `harness` 面板（§20）；
仍保持 `am-assistant` 的是各场景的"场景助手"，因为它们要的是"带实时快照的一句话结论"，不是长会话。

### 14.3 清理了什么

| 项 | 处理 |
|---|---|
| 作者个人素材：启动视频 15MB、B站/党建/徽章图标 | 已删（17.7MB → 2.4MB） |
| `启动.vbs`（UTF-8 中文会被 WSH 拆坏） | 删除，改 `start.cmd`（纯 ASCII）+ `scripts/launch.cjs` |
| `外壳/scripts/`：`建会话 / 换会话 / 归档会话 / 会话改名 / check-gui`（DSH 会话专用） | 删除（无残留调用） |
| 原场景：命令 / B站 / 自我复盘 / 本地电脑（json + context md） | 删除，换成我们的 5 个 |
| 原场景记忆骨架（4 个场景目录） | 删除，换成我们的 5 个 |
| `说明/使用说明.md`（原作者的产品说明） | 重写为我们的 |
| `引擎数据\.dsh\` 里 AI 会话/技能样例 | 保留骨架（模板的记忆方法论仍在用） |

**保留但不在用的**：`renderers.js` 里 `pc-*` / `review-*` / `bl-*` / `site-*` / `webai` 等渲染器约 1MB。
不删的原因：它们是模板的一部分、互相引用较多，删了容易连带断；而且以后要做"本地文件""预览"
类面板可以直接复用。文档里明确标注"未使用"，避免误以为是我们写的。

### 14.4 新增：`agentmatrix-workbench/README.md`

把"哪些是模板原版、哪些是我们写的、哪些没用"写成一张目录表，避免下次维护时找不到边界。
## 15. 第十一轮：把 DSH 找回来（方向修正）

### 15.1 我之前错在哪

读模板的 `00-核心机制`（协作 / 记忆 / 场景体系）才明白，这套工作台的设计前提是：

> **DSH 是大脑**：一个场景 = 一类反复回来的活 = 一个 DSH 会话；记忆必须是文件（会话会被换掉）；
> 会话之间靠派单/回执协作。
> **界面只是手和眼**：壳负责摆面板、记状态、把人的动作递进去。

我却把 AI 换成了自己写的一次性调用（`/workbench/ask`），既没有会话、也没有记忆注入、
也没有派单回执 —— 于是**DSH 在界面上消失了**。这就是"看不出和 DSH 有关"的原因。

### 15.2 真正的连接点在哪（本来就有，只是没露出）

`dsh-plugins/agentmatrix-tools/` 是一个 **DSH 插件**，已装进当前 profile
（`~/.dsh/profiles/desktop/package.json` 的 bundles 里有 `dsh-agentmatrix-tools`），
它向 DSH 注册 4 个工具：

| 工具 | 作用 |
|---|---|
| `agentmatrix_create_task` | 在平台发起任务并返回调度决策 |
| `agentmatrix_run_status` | 查某次运行的状态与步骤 |
| `agentmatrix_explain_dispatch` | 解释为什么派给这个智能体 |
| `agentmatrix_matrix_coverage` | 看矩阵覆盖与缺口 |

也就是说：**在 DSH 里说一句"订单 SO-xxx 延误了，建个 P1 任务"，DSH 会调工具把活落到平台**，
平台跑工作流 → 工作台面板里能看到任务、运行、审批、审计。这条链路原本就通，
只是界面上没有任何地方说明它存在。

### 15.3 这一轮做了什么

1. **插件打来源标记**：`agentmatrix_create_task` 写入 `payload._source='dsh'`（含工具名与时间），
   任务面板新增「来源」列（DSH / 界面）—— **一眼看出这单是谁派的**；
2. **新面板「DSH 大脑」**（工作台总览右下）：
   - 三层关系卡片：DSH 大脑（会话·文件记忆·派单回执）/ AgentMatrix 执行器（工作流·智能体·调度·审计）/ 壳；
   - 状态标签：插件是否已装进 DSH、来自 DSH 的任务数；
   - 4 个工具清单 + **一句可复制的话术** + 「打开 DSH 会话」按钮；
3. 端到端实测：带 `_source=dsh` 建任务 → 平台返回任务 id，任务面板「来源」显示 **DSH**，
   「DSH 大脑」面板统计变成 1 条。

### 15.4 还差的一步（第十二轮已补上，见 §16）

> **⏳ 已过期**：引擎已经装进 `引擎\`，总览的「DSH 会话」面板就是这一步的落地（§16.3、§20）。
> 下面保留当时的判断。

模板给每个场景配的是 `harness` 面板（内嵌 DSH 会话，靠 `sessionTitle/sessionId/pinTarget` 钉住）。
要用它，必须让工作台**自己拉起引擎**（`引擎\apps\cli\lib\bin.js`）或**拿到运行中实例的 token**——
本机是打包安装的 DSH，两者都拿不到，所以目前是"工作台看数据 + DSH 在另一个窗口当大脑"。

要补上这一步，只有两条路：
1. 装一份独立的 DSH 引擎目录到 `引擎\`（模板原生支持，装好即用）；
2. 或者让主进程能拿到运行中实例的 token（需要改它的取 token 逻辑）。

在此之前，至少**关系是可见、可解释、可验证的**：插件状态、来源列、话术示例都在界面上。
## 16. 第十二轮：把 DSH 引擎真正装起来（工作台自己拉起它）

### 16.1 装了什么

引擎是 npm 上的 **`@deepseek-ai/dsh`**（bin = `lib/bin.js`，解包 6.2MB，要求 Node ≥ 24.9）。
装到 `agentmatrix-workbench/引擎/`：

```bat
cd agentmatrix-workbench\引擎
npm install          :: 依赖写在 引擎\package.json 里（@deepseek-ai/dsh 0.2.2-rc.5）
```

`引擎/apps/cli/package.json` 只用于版本显示；真正的入口是
`引擎\node_modules\@deepseek-ai\dsh\lib\bin.js`。

### 16.2 三个必须的改动（否则引擎起不来）

| 现象 | 原因 | 改法 |
|---|---|---|
| 引擎静默退出 | 模板用 `引擎\apps\cli\lib\bin.js` 作入口，我放了一个 `import()` shim 转过去 —— 但引擎按 `argv[1]` 定位自身资源，被 shim 一挡就找不到、无报错退出 | `main.js` 的 `CLI_BUILT` 改成一个**候选列表**：优先 `引擎\node_modules\@deepseek-ai\dsh\lib\bin.js`，其次才是 `apps\cli\lib\bin.js`；删掉 shim |
| `engine start failed`（profile 找不到） | `main.js` 把 `DSH_HOME` 指到 `引擎\.dsh`，那里没有 profiles | `scripts/launch.cjs` 传 `DSH_CUSTOMER_HOME=%USERPROFILE%\.dsh`（复用你已装的 profile 与插件） |
| 端口被自己占用 | 之前为了复用外部实例把 `DSH_PORT` 设成 58360 | `工作台配置.ini` 改回 `DSH_PORT=3083`（工作台自己的引擎） |

### 16.3 实测

```
[boot] direct: node ...\引擎\node_modules\@deepseek-ai\dsh\lib\bin.js web --no-open --port 3083
engine ready in 13.2s via 内置入口
[token] captured: LtiHj4DGS6UNDxJawh5oUOXGgkTjVK7wNKR61ZNIWEI
[out] dsh web: http://127.0.0.1:3083/?token=...
```

- `window.app.isHarnessReady()` → **true**
- `getHarnessUrl()` → `http://127.0.0.1:3083/?token=***`
- 「DSH 引擎」场景打开就是**真实的 DeepSeek Harness 界面**（工作区里能看到你自己的项目与会话）
- 工作台总览新增「DSH 会话」面板（`type: harness`，`sessionTitle: 工作台总览`），
  一个场景一个 DSH 会话的模型终于落到了界面上

### 16.4 换台机器怎么装

```bat
:: 1) 装引擎
cd agentmatrix-workbench\引擎
npm install

:: 2) 确认 DSH 家目录（profiles 所在）
::   默认用 %USERPROFILE%\.dsh；要隔离就在环境变量里设 DSH_CUSTOMER_HOME

:: 3) 起工作台（会自己在 3083 拉起引擎）
cd ..
start.cmd
```

首次启动约 **13–16 秒**（引擎冷启动），之后切换场景是秒级。

### 16.5 代价与边界

- 引擎与工作台共用同一个 `~/.dsh`：**工作台里的 DSH 就是你在桌面端用的那个**（会话、插件、技能都在）。
  好处是插件（`dsh-agentmatrix-tools`）与历史会话直接可用；代价是两者会共享上下文。
  想隔离就把 `DSH_CUSTOMER_HOME` 指到单独目录，但要重新装一次插件。
- 引擎的 5 个原生依赖（koffi / node-pty 等）安装脚本被 npm 拦了，但 web 模式不需要它们；
  如果以后要用终端类功能，需要 `npm install-scripts approve` 再重装。
## 17. 第十三轮：深色融合、启动门兜底、后台语义

### 17.1 DSH 界面是亮色，和工作台不搭

**原因**：DSH 的 Web UI 跟随 `prefers-color-scheme`（`ui-theme` 插件：`system/light/dark`），
而工作台自己是深色 ⇒ 嵌进来一块亮一块暗。

**做法（融合，不求一模一样）**：
1. `main.js` 启动时 `nativeTheme.themeSource = 'dark'` —— 整个应用（含 webview）的
   `prefers-color-scheme` 变深色，DSH 界面随之变深；
2. `web-contents-created` 里对每个 webview 注入一小段 CSS，只调"接缝处"：
   `color-scheme: dark`、滚动条样式、`::selection` 颜色 —— 不改它的布局与组件；
3. 工作台自己的配色（`#0b0d12` / `#4f8cff`）保持不变，两边靠"同为深色 + 同一套滚动条/选中色"融在一起。

想恢复 DSH 自己的浅色：在 DSH 设置 → 外观里改；或者删掉 `main.js` 里那行 `nativeTheme`。

### 17.2 启动卡在「引擎已就绪，正在加载界面 92%」

**原因**：模板的启动门在等 harness（内嵌 DSH）报"页面就绪"。内嵌的 DSH 是个完整 SPA，
首次加载要十几秒，报不到就停在 92%。「立即进入」按钮本来就是这个场景的官方出口
（模板注释写的是"等同切场景再切回来"）。

**改法**：`retarget.js` 加 `autoEnterWhenStuck()` —— 页面停在"加载中"超过约 16 秒就自动点「立即进入」，
不需要人盯着。正常加载完的话它不会触发。

### 17.3 关掉工作台，我还在工作吗？

**不在。** 因果关系是这样的：

```
workbench（Electron）
  └── DSH 引擎（node 子进程，3083）  ← 我（Agent）跑在这里
        └── 会话 / 工具调用
```

- 工作台一关 → 引擎子进程被杀 → **会话结束**，正在跑的对话/工具链随之中断；
- 但**已经派到平台的活不会被中断**：任务的执行在 Docker 里的 worker（`apps/worker`），
  工作台和引擎都只是"发起方"。关掉工作台后，工作流照样跑完，审批节点会等下次有人处理；
- 想让 AI 长时间干活，正确做法不是"开着窗口等"，而是**用 DSH 里的工具把活派给平台**
  （`agentmatrix_create_task`），或者用平台的定时/批处理 —— 这才是"关掉工作台也继续"。

### 17.4 所有面板 `fetch failed` 与"对话一卡一卡"

- `fetch failed` = 平台容器被 WSL 回收（闲置会停）。`dev up` 拉起来后恢复；
  常驻会话能避免再被回收（`scripts\dev.ps1 up` 会起一个 keepalive）。
  现在打开工作台就会自动探活并拉起平台（见 §20.4），不用再手动 `dev up` 了。
- 卡顿：面板原来各自轮询（15/20/25/30 秒），加上对话本身很长的上下文，会互相抢。
  已把轮询统一放宽到 **30–45 秒**；另外这个会话已经很长，**建议新开一个会话继续**，
  响应会明显快（上下文长度是主要成本）。
## 18. 第十四轮：内嵌的 DSH 改成"项目专用"

用户的诉求：**嵌进来的 DSH 不该是桌面端原样，而应只在本项目目录工作，并去掉无关功能。**

### 18.1 做法：分开的 DSH 家目录 + 专用 profile

| 项 | 之前 | 现在 |
|---|---|---|
| DSH 家目录 | `%USERPROFILE%\.dsh`（桌面端在用：毕业设计 / 学生工作对接 / 多媒体技术 三个工作区） | `agentmatrix-workbench\引擎\.dsh`（工作台专用） |
| profile | 官方 `web` | 自定义 `workbench`（由官方 web 模板复制而来，见 `引擎/.dsh/profiles/workbench/`） |
| 工作区 | 3 个 | **1 个**：`D:\Document\毕业设计\agentmatrix-sc`（`storages/workspace.json` 预置） |
| 模型 | 桌面端配置 | 凭据从 `~/.dsh/.credentials.yaml` 复制；profile patch 里写死 `deepseek-account / deepseek-flash / high` |
| 启动参数 | `dsh web --no-open --port` | `dsh workbench --no-open --port`（`main.js` 的 `WORKBENCH_PROFILE`，可用环境变量 `DSH_PROFILE` 覆盖） |

实测（不动正在用的会话，另起 3086 验证）：

```
node 引擎\node_modules\@deepseek-ai\dsh\lib\bin.js workbench --no-open --port 3086
→ dsh web: http://127.0.0.1:3086/?token=...   （401 without token = 鉴权正常）
```

### 18.2 为什么不是"把界面改掉"

DSH 的界面由几十个 client 插件组成（`ui-workspace` / `ui-sidebar-*` / `ui-plugin-market` …），
"新建工作区""插件市场"这类入口是插件注册的。要真正去掉，得在 profile 的
`cordis.patch.yml` 里按 **loader row id** 写 `disabled: true`，而 row id 不在文档里、
要靠 `dsh workbench --dump-config` 打出来再逐条确认。

我没有猜 id 去硬关（关错会把界面弄坏），这轮只做了**确定性最高**的部分：
工作区收成一个、profile 独立、模型配置固定。**下一步**：

```bat
cd agentmatrix-workbench\引擎
set DSH_HOME=%CD%\.dsh
node node_modules\@deepseek-ai\dsh\lib\bin.js workbench --dump-config > ..\..\docs\profile-dump.yml
:: 从里面找 ui-workspace / ui-plugin-market / ui-sidebar-browser 等行，拿到 id，
:: 再在 引擎\.dsh\profiles\workbench\cordis.patch.yml 里加：
::   - id: <row-id>
::     disabled: true
```

### 18.3 没装上的一件事（如实说）

`dsh-agentmatrix-tools`（我们那 4 个工具）**还没进这个新 profile**：
`dsh plugin --profile workbench add ...` 依赖 pnpm，本机没装。补法：

```bat
npm install -g pnpm
cd agentmatrix-workbench\引擎
set DSH_HOME=%CD%\.dsh
node node_modules\@deepseek-ai\dsh\lib\bin.js plugin --profile workbench add link:D:/Document/毕业设计/agentmatrix-sc/dsh-plugins/agentmatrix-tools
```

在此之前，工具调用仍可在**桌面端 DSH**（原 profile）里用；工作台内嵌的这个引擎暂时只有对话能力。
## 19. 第十五轮：把工作台专用 DSH 做成可复现

### 19.1 安装 pnpm（一次性）

```bat
npm install -g --allow-scripts=pnpm pnpm   :: 必须带 --allow-scripts，否则 pnpm 的 bin 是坏的
pnpm --version                             :: 12.x
```

### 19.2 生成工作台专用 DSH 家目录

`引擎/.dsh` 里有凭据与运行时数据，**不进版本库**；裁剪逻辑写成脚本：

```bat
node agentmatrix-workbench\scripts\setup-dsh-home.cjs
```

它会做五件事：
1. 建 `引擎/.dsh` 目录；
2. 写 `workbench` profile（官方 web 模板结构 + 我们的模型配置）；
3. 预置**唯一工作区** = 本项目根目录（`storages/workspace.json`）；
4. 从 `~/.dsh` 复制凭据（模型可用）；
5. 若有 pnpm，把 `dsh-agentmatrix-tools` 装进该 profile。

### 19.3 已按真实 row id 裁掉的入口

row id 来自 `dsh --profile workbench --dump-config`（不猜）：

| row id | 插件 | 为什么关 |
|---|---|---|
| `tool-plugin-market` | `dsh-plugin-market/tools` | 本项目只用自己写的插件，不需要市场 |
| `ui-sidebar-browser` | `dsh-client-ui-sidebar-browser` | 工作台自己就是壳，不需要再嵌一个浏览器 |

实测：裁剪后 `--dump-config` 仍能正常解析（46KB，3 处 `disabled: true`），
引擎在 3087 端口正常启动并打印 token。

### 19.4 仍保留但可以再裁的

`ui-workspace`（侧栏工作区列表，"新建工作区"按钮在它里面）、`ui-jobs`、`ui-schedule`、
`ui-sidebar-files`、`ui-sidebar-terminal`、`ui-deliverables`。
没有一刀关掉的原因：`ui-workspace` 同时负责会话分组，关掉侧栏也就没了；
要只去掉"新建工作区"这个按钮，得改它的组件（属于改 DSH 源码层面），或者用注入脚本按文案隐藏。

## 20. 第十六轮：平台自启动 + DSH 会话面板布局修复（2026-11-23）

> 编号沿用正文顺序（上一节是 §19 第十五轮）。这一轮做的两件事互不相干，但都是"打开就能用"的问题。

### 20.1 现象：DSH 会话面板的输入框"越打字越往左挤"

总览的「DSH 会话」面板（`ov-chat`，`type: harness`）里：

- 面板宽 715px 时，会话列只占 **314px 且贴在右侧**，左边空出 **401px** —— 看着像"输入框缩在右边"；
- 输入框没有跟着面板铺满；每多打一个字，输入框左边界就往左挪一点，越长越明显；
- 拉宽窗口、点「刷新当前场景」都不自愈（重新注入后依旧）。

### 20.2 根因：三列显式摆位 + 单轨道 ⇒ 生成隐式自动列

引擎的 AppFrame（`dsh-client-ui-layout` 的 `AppFrame.module.css`）把三列**显式摆位**
（下面是示意，实际是 CSS Modules 的类名）：

```
sidebarCol   → grid-column: 1
centerCol    → grid-column: 2
rightbarCol  → grid-column: 3
```

精简模式原来把 grid 压成**一条轨道** `minmax(0, 1fr)`。第 2/3 列没有显式轨道可落，
CSS Grid 就按 `grid-column` 自动**生成隐式列**：隐式列按内容宽度撑、剩余空间全给第 1 列 ⇒
会话列被推到右边，输入框随内容变宽时隐式列继续长、左边界一路往左挤。

换句话说：**子项用 `grid-column:2/3` 摆位，轨道数就必须留三条**；少一条不是"省掉两侧"，
而是"多长出两条隐式列"。

### 20.3 修法：`0px minmax(0, 1fr) 0px`

保留三条轨道、把两侧压成 0，中间那条才是真正的 `1fr`：

```css
[style*="grid-template-columns"][style*="minmax(0"] {
  grid-template-columns: 0px minmax(0, 1fr) 0px !important;
}
```

JS 兜底（React 重渲染会把内联样式顶回去）改同一行：

```js
f.style.setProperty('grid-template-columns', '0px minmax(0, 1fr) 0px', 'important');
```

**两份常量必须同步**，否则一条链路修好、另一条链路又坏回去：

| 文件 | 常量 | 用在哪 |
|---|---|---|
| `外壳/main.js` | `HARNESS_CHAT_CSS` / `HARNESS_FIX_JS` | 主进程 IPC `harness:wv:inject`（渲染层调用）：`insertCSS` + `executeJavaScript`，另有常驻 MutationObserver/定时器兜底 |
| `外壳/renderer/renderers.js` | 同名两份（内容一致） | 渲染层 `renderers.harness` 自己的注入路径（同一面板的第二个保险） |

两侧压成 0 之后仍然 `display: none`（`[data-side="sidebar"]`、`[data-side="details"]`、
`[data-width-handle]`、`[data-phase] > header`），所以**视觉结果不变**：只剩会话列 + 输入框，
只是这次它们占的是真 `1fr`，不再靠隐式列凑。

### 20.4 平台自启动：打开工作台就有平台

以前必须先手动 `dev up`，否则面板全是 `fetch failed`。现在（2026-11-23 新增）流程是：

```
start.cmd
  └── scripts/launch.cjs → Electron
        ├── 并行：① 启动页 + 引擎（DSH_PORT=3083）   ② ensurePlatform()
        └── ensurePlatform()
              ├── GET http://127.0.0.1:8000/health
              ├── 已在跑 → stage:'ready'（秒回，不重复起）
              └── 没在跑 → spawn cmd /c dev.cmd up（仓库根目录，WSL 常驻 + docker compose，幂等）
                    └── 轮询 health（默认上限 AM_PLATFORM_WAIT_MS=180000）
                          ├── 就绪 → stage:'ready'
                          └── dev up 退出/超时 → stage:'failed'（启动页那行可点重试）
```

- **启动页状态**：`#boot-platform` 一行字，`平台启动中… Ns（WSL + docker，首次较慢）` →
  `平台已就绪 · 接口 8000 / 站点 5173`；失败变红、可点重试（`platform:retry`）；
- **面板请求会等平台就绪**：`am:get / am:post` 前先 `waitPlatformReady()`，冷启动只是多转一会儿圈，
  不会先抛一串 `fetch failed`；
- **不想自动起平台**：`set AM_PLATFORM=0` 再 `start.cmd`，启动页那行留空（不再自动起平台），
  只复用你手动起的那份（`AM_HEALTH` 可改探测地址）；
- 平台冷启动通常 10–60 秒（WSL 发行版首次启动 + 容器 healthy 需要时间）；它和引擎启动**并行**，互不阻塞。

### 20.5 怎么验证的（可复核）

1. **真实 DSH 页对照**：用系统 Edge（Playwright）直接打开 `http://127.0.0.1:31238/chat`（保命入口，经 3083 引擎，
   不经过 Electron），视口分别取 715×718 与 1252×1257；向页面注入单轨道 `minmax(0, 1fr)` 后立刻复现
   "会话列贴右、左侧留 401px"（1252 宽时是 938px 空白），再注入 `0px minmax(0, 1fr) 0px` 就恢复正常。
   说明问题出在"轨道数"，与 Electron 容器无关；
2. **隔离实例截图**：复制一份外壳到 `外壳-test`（独立 userData，复用同一引擎），只加载同一段注入代码，
   注入后的诊断从 `centerCol x=235 w=480` 变成 `centerCol x=0 w=673`，前后各截一张；
3. **平台自启动逻辑单独跑两条路径**（把 main.js 里那段原样抽出来、用假 dev.cmd 驱动）：
   - 成功路径：假健康检查 2 秒后才通 → `ensurePlatform()` 约 3.0s 返回 ready，并完整发出
     `check → starting → starting(Ns) → ready` 事件；
   - 失败路径：假 dev.cmd 退出码 3 → 约 9 秒判 failed 收工（不会让面板空等满 3 分钟）；
4. **回归**：`node tests/e2e/workbench.mjs`，**18 步**全绿（5 个场景各 1 步 + 13 个功能步）。
   - 第 01 步：五个场景标签都在、启动落地 `overview`、**「DSH 引擎」标签保留**（不再要求它隐藏）；
   - 每场景那几步断言 **21 个原生面板里 `webview/iframe = 0`**，而「DSH 会话」面板**允许且仅允许 1 个 `webview`**；
   - 运行方式：工作台退出后直接跑；工作台开着时用 `set WB_SHELL_DIR=agentmatrix-workbench\外壳-test`
     指向隔离外壳副本，再跑同一条命令。

### 20.6 现在的实测基线（2026-11-23）

| 项 | 数字 |
|---|---|
| 工作台 | 5 个场景 / 22 个面板 = **21 个原生面板**（18 种渲染器）+ **1 个「DSH 会话」harness webview** |
| 面板分布 | 总览 7 · 工作流设计 2 · 能力矩阵 4 · 交付追踪 3 · 治理与策略 6 |
| 启动 | `start.cmd` → `scripts/launch.cjs` → Electron；落地 `overview`（`customer-start.js` 的 `FIRST`）；「DSH 引擎」场景标签保留在最前（真会话入口，固定不可拖） |
| 引擎 | `工作台配置.ini` 的 `DSH_PORT=3083`；监听就复用，没跑就自己拉起（profile=`workbench`，`DSH_HOME=引擎/.dsh`） |
| 平台 | 自启动（探 `/health` → `dev.cmd up`），`AM_PLATFORM=0` 可关 |
| 平台数据 | 接口 52 条路径 / 60 个操作；单测 102（宿主机）/ 128（容器）；业务 E2E 17 步；路由冒烟 18 页；矩阵 26/32 = 81.25%；4 条工作流；种子智能体 / 技能各 15；真实运行实验 8 条 / $0.0056 |
| 回归 | **18 步**（5 个场景各 1 步 + 13 个功能步）；刷新后原生类型注册表 18 个 |
| 版本 | DSH 0.2.2-rc.5 · Electron 43.4.0 · 工作台 0.2.1-rc.3 |

### 20.7 这一轮的教训

- **Grid 的隐式列是静默故障**：不报错，只是位置不对，而且会随内容宽度漂移 ——
  子项带 `grid-column` 时，轨道数必须与最大列号一致；
- **同一份注入常量有两个副本时，改一处等于没改**（主进程 + 渲染层各一份）；
- **"启动要几步"是可用性问题**：能自动探活 + 拉起，就不该让文档教人背命令。
