# 工作台：改用成熟模板 + 换领域（2026-11-23 第二次重做）

> 前两版为自研外壳（`agentmatrix-shell/`），因仅在外观上仿照、交互、密度与面板能力均需从头实现而被否决。
> 现改为**直接使用一套成熟的工作台模板（MIT），只替换其领域**。
> 代码在 [`agentmatrix-workbench/`](../agentmatrix-workbench/)。

## 1. 换成了什么

| | 前两版（已删） | 现在 |
|---|---|---|
| 来源 | 自研渲染层（约 900 行） | `luanyujia-workbench` 的公开模板（MIT；模板本身未随本仓库分发，`12-源码照搬`） |
| 面板类型 | 5 种（view/status/memory/chat/links） | 模板自带 20+ 种（`harness` / `embed` / `file` / `chart` / …），且带标题栏工具、展开、自刷新、拖拽分屏 |
| AI | 自研 `/workbench/ask` | 模板的 `harness` 面板：**每个场景一个 DSH 会话**，靠 `sessionTitle` 钉住（仅总览启用，其余场景仍为原生助手） |
| 记忆 | 自研 `memory/*.md` | 模板的 `引擎数据/.dsh/场景记忆/<场景>/`（含 §〇 交接、归档、跨场景留言工具） |
| 启动 | 自研 Electron 壳 | 模板的 `main.js`（原版 4896 行，改造后约 5200 行；含引擎复用、保活入口、崩溃保护、端口自愈） |

**结论**：外观来自同一套模板代码，改造只替换领域。

## 2. 领域替换清单（改了哪些）

| 位置 | 原来（模板作者的领域） | 现在（本项目） |
|---|---|---|
| 场景 | 命令 / B站 / 自我复盘 / 本地电脑 | 工作台总览 / 工作流设计 / 能力矩阵 / 交付追踪 / 治理与策略 |
| 场景面板 | 神经元视图、B站网页、文件库、磁盘清理 | 原生面板（快照/任务/审批/矩阵/运行/审计/调度/账号等）+ **每个场景一个**「DSH 会话」（`harness`）。2026-11-24 起 AI 问答只走 DSH 会话，原「场景助手」（`am-assistant`）面板已从四个场景移除（见 §25） |
| 品牌 | DSH 引擎 · 淋雨家的工作台 | AgentMatrix-SC · 供应链智能体矩阵 |
| 静态服务 | 个人站 + Blender 实时画面 | 保留服务但不使用（`SITE_DIR` 指到本仓库目录） |
| 顶栏入口 | 豆包 / 通义 / 智谱 / Kimi / 市场 / 捐赠 / 个人站 | 用 `renderer/retarget.js` 收起（不动模板代码，可随时恢复） |
| 启动器 | `启动.vbs`（固定 3083 + 自带引擎目录） | `start.cmd`（纯 ASCII）→ `scripts/launch.cjs`，端口从 `工作台配置.ini` 读 |
| 登录态 | 无（模板没有这个概念） | 面板 URL 带 `embed=1&theme=dark&as=ops`，主站据此自动用演示账号登录 |

## 3. 关键取舍：不自起引擎，复用运行中的 DSH（第十二轮已改，见 §16）

> **已过期（2026-11-23 校注）**：本节为第三轮当时的取舍。独立引擎装好后（§16），工作台两条路都会走：
> `DSH_PORT`（现为 **3083**）在监听就复用（日志 `reuse: port already listening`），
> 未运行则自行拉起 `引擎\node_modules\@deepseek-ai\dsh\lib\bin.js`（profile=`workbench`，`DSH_HOME=引擎/.dsh`）。
> 「工作台不自己起引擎」「harness 永远未就绪」两条均已不成立；原始记录保留如下。

模板启动时有两步：先探测 `DSH_PORT`，**端口已在监听就直接复用**（`engineIsForeign = true`），
否则才去 spawn `引擎\apps\cli\lib\bin.js`。

本机当时没有可用的 `引擎\` 目录（DSH 为打包进 `app.asar` 的安装版，没有 `apps/cli`）；**第十二轮起该结论不成立**，
独立引擎已装进 `引擎\`（§16）。当时的做法：

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

> **后续处理**：第十二轮采用第 1 条（装一份独立引擎到 `引擎\`，§16），总览的 `harness` 面板
> 因此可用（§20）；仅「复用外部实例」时才会拿不到 token。

内容面板（`embed`）不受影响：它们嵌入的是本项目站点，已在运行。

## 4. 登录态怎么解决

模板的 `webview` 与本项目站点不同源，读不到 localStorage；逐面板手输账号不可行。
做法是在主站（`apps/web/src/auth.tsx`）加一条**仅在 embed 模式下生效**的演示登录：

```
http://127.0.0.1:5173/runs?embed=1&theme=dark&as=ops
                                       ↑        ↑
                                     隐藏导航   自动用演示账号登录
```

- 只认 `embed=1`；正常访问站点仍然是登录页；
- `as` 只能是演示账号（`ops`/`dev`/`admin`/`viewer`），密码写死为演示密码；
- 本地演示壳不对外暴露；上线需改为签名 token。

## 5. 编码相关的问题（均按 HANDOFF 第 0 条准则处理）

| 文件 | 现象 | 处理 |
|---|---|---|
| `scenarios/*.json` | PowerShell 写文件带 BOM，`JSON.parse` 直接拒绝，场景被静默跳过 | 存 UTF-8 **无 BOM** |
| `start.cmd` | 写了中文路径/提示，cmd 按 GBK 解析 UTF-8，整份脚本被拆成乱码命令 | **纯 ASCII**，逻辑搬到 `scripts/launch.cjs` |
| `启动.vbs` | UTF-8 中文把语句拆坏（"缺少语句"） | 直接弃用 VBS，改用 `.cmd` + Node |

## 6. 怎么启动

> **干净克隆需先安装一次**：`外壳/node_modules`、`引擎/node_modules`、`引擎/.dsh` 与仓库根 `.env` 均不进版本库；
> 完整首次安装见 [`agentmatrix-workbench/README.md`](../agentmatrix-workbench/README.md) 的「首次安装」，装完再按下述方式启动。

```bat
:: 1) 平台（在仓库根目录；2026-11-23 起这一步可以省：start.cmd 会自己探 /health 并跑 dev.cmd up，见 §20.4）
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
2. 模板自带的 `pc-*` / `review-*` / `neuron` 等渲染器仍在代码中（约 1MB），没有场景使用；
   保留以便后续直接新增场景；
3. 模板顶栏还有"文件夹""工具""插件"等入口，属于模板能力，保留；
4. 自研 `agentmatrix-shell/` 已删除（git 历史可查），避免两套外壳并存。

## 8. 第三轮：AI 面板真连通 + 面板宽度 + 去掉 emoji

### 8.1 AI 面板：换成自研场景助手页

模板的 `harness` 面板依赖两样东西：`引擎\apps\cli`（本机为打包安装，不存在）与引擎启动时打印的
**token**（复用运行中的实例时不可得，直接访问返回 401）。两者均不可得，因此改为自研页面：

```
/assistant?embed=1&theme=dark&as=ops&scene=delivery
```

- 后端用已有的 `POST /workbench/ask`：**场景 + 问题 → 实时快照 + 模型结论**；
- 页面顶部先展示快照（待审批 / 24h 成功 / 矩阵覆盖 / 当前策略），便于确认助手读取的数据范围；
- 回答下方带 token 与成本，和平台其他地方口径一致。

无头浏览器实测（同 URL、同后端）：

```
facts = 待审批 2 · 24h 成功 32 · 失败 1 · 矩阵覆盖 26/32（缺口 6）· 策略 加权打分
answer = ① 现状：24 小时内运行 32 成功、2 待审批、1 失败…… ② 判断：最近失败的是运行 3552cf54，
         错误码 TRANSIENT（瞬时性故障）…… 快照里没有更细的失败原因字段，无法进一步定位
meta  = deepseek/deepseek-flash · 851 tokens · $0.000494 · 2735ms
```

最后一句体现提示词中的固定规则：**快照中不存在的信息直接回答没有**。

### 8.2 面板宽度：350px 会被裁，716px 正常

模板用 `<webview>` 嵌页面。本机显示缩放 170%，实测：

| 面板宽度 | 结果 |
|---|---|
| 350px（4 列布局的 1 格） | 内容右侧被裁掉（guest 按设备像素布局，没有横向滚动） |
| 716px（4 列布局的 2 格） | 完整显示 |

因此四个场景均改为**一宽 + 一助手**两栏（`w: 2` + `w: 2`）：
左侧为该场景主视图，右侧为场景助手。信息密度下降，但未出现裁字。
（属 webview 在高 DPI 下的固有行为，CSS 无法修正。）

### 8.3 面板标题栏按钮去掉 emoji

模板的按钮为 `⛔ 取消内置 / 🔄 刷新 / 🌐 浏览器打开`，图标风格与本工作台深色细线界面不协调。
`renderer/retarget.js` 用 MutationObserver 在面板出现后去掉前缀图标（只改文字，不动事件），
现显示为 `取消内置 / 刷新 / 浏览器打开`。

### 8.4 嵌入模式下的布局规则

本项目页面原本按整页设计（`.content` 有 `max-width: 1320px`、表格按宽屏排）。
主站在 `?embed=1` 时给 `<html>` 打 `data-embed`，样式表里对应放宽：

- `.content` 去掉最大宽度与整页内边距；
- `.grid-4` 改成 `auto-fit, minmax(130px, 1fr)`；
- 表格放进卡片，卡片自行横向滚动（**禁止**给 table 设 `min-width`，否则页面整体溢出）。
## 9. 第四轮：面板必须自己完成功能（去掉全部浏览器嵌入）

该轮要求面板独立完成功能，不通过浏览器间接显示。
因此 `embed` 面板全部替换为模板内注册的**原生渲染器**：面板自行绘制表格、筛选并
发起请求，代码中不含 `<webview>`，也不含 `<iframe>`。

### 9.1 实现方式（三层，均在模板自身机制内）

```
renderer/am-panels.js        ← 注册 renderers['am-kpi'] 等 6 个原生面板
        │ window.am.get/post（preload 暴露）
main.js                      ← 代理 AgentMatrix API：登录一次拿 JWT，401 自动重登
        │ fetch http://127.0.0.1:8000/api/v1/...
AgentMatrix 后端              ← 真实数据
```

- **不把 token 交给渲染层**：登录在 main.js 里做，渲染层只能调 `am.get/am.post`；
- **面板用模板的变量画**（`--bg-panel` / `--border` / `--text-dim` / `--accent` / `--ok` / `--err`），
  所以与外壳观感统一，没有嵌套窗口的阴影与圆角；
- **加面板 = 加一个函数**，与模板原有 20 个渲染器完全同构。

### 9.2 六个原生面板

| 类型 | 面板 | 关键交互 |
|---|---|---|
| `am-kpi` | 场景快照 | 待审批/24h 成功/失败/积压 + 覆盖率条 + 策略名（中文），15 秒自刷新（后改 30 秒，见 §17.4） |
| `am-tasks` | 任务 | 状态筛选（全部/待审批/失败/已完成）、点行展开业务参数与所需能力 |
| `am-runs` | 运行监控 | 20 秒刷新、点行展开运行明细并**再拉一次详情**显示步骤轨迹（后改 30 秒） |
| `am-audit` | 审计日志 | 动作下拉筛选（选项来自 `/audit-logs/summary`）、点行看变更前后 |
| `am-matrix` | 能力矩阵 | 8×4 原生网格：有智能体显示数量、空的标「缺」并虚线描红；列出优先要补的格子 |
| `am-assistant` | 场景助手 | 建议问题 + 输入框 → `POST /workbench/ask`，显示 token 与成本（2026-11-24 已从所有场景移除，渲染器与接口保留，见 §25） |

场景（4 列网格）：

```
工作台总览：场景快照(1×2) + 任务(3×2) / 场景助手(4×2)
能力矩阵  ：能力矩阵(3×4) + 场景助手(1×4)
交付追踪  ：运行监控(3×4) + 场景助手(1×4)
治理与策略：审计日志(3×4) + 场景助手(1×4)
```

### 9.3 回归：将「禁止嵌入网页」写成断言

`tests/e2e/workbench.mjs` 自己拉起 Electron（`--remote-debugging-port`）+ CDP 连进去，7 步：

```
✅ 01 四个场景标签都在
✅ 02~05 每个场景：面板标题齐全、正文有真实数据、**面板内 webview/iframe 数量必须为 0**
✅ 06 场景助手真的回答（deepseek-flash · 961 tokens · $0.00061 · 3264ms）
✅ 07 无渲染层报错
```

第 02~05 步的断言即对应这条要求：若将面板改回 `embed`，测试立即失败。

### 9.4 问题记录：preload 中 `require` 之前不能使用 `contextBridge`

第一版将 `contextBridge.exposeInMainWorld('am', …)` 写在
`const { contextBridge } = require('electron')` **之前**，整个 preload 抛错，
`window.app` 随之丢失，表现为**所有场景面板为空**（含模板自带面板）。
preload 在 Node 环境执行，语句顺序即执行顺序：先 require，后 expose。
## 10. 第五轮：功能补齐（16 个原生面板，全部可操作）

第五轮前仅有 6 个面板，缺少可修改数据的功能。该轮补齐到 **16 个原生面板**
（后续增至 20 个原生面板 + 每个场景 1 个「DSH 会话」；「DSH 大脑」已于 2026-11-23 删除，「场景助手」已于 2026-11-24 删除，**现状 16 原生 + 5 harness = 21 面板**见 §25），
平台侧功能在工作台内基本闭环（查看 → 操作 → 留痕）。

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

> **轮询间隔**：表中 15 / 20 秒为第五轮数值；第十三轮已统一放宽到 **30–45 秒**
>（`am-kpi`、`am-approvals`、`am-deadletters`、`am-chart` 等 30 秒，`am-alerts` 45 秒），见 §17.4。

### 10.2 账号：默认开发者

写操作的角色要求不一致（审批接受 operator/developer，调度保存与工作流校验只接受 developer），
因此 `main.js` 的默认账号改为 `dev@agentmatrix.local`，**一个账号覆盖全部写操作**。
更换方式：环境变量 `AM_EMAIL` / `AM_PASSWORD`，或修改 `main.js` 顶部默认值。

### 10.3 回归扩展到 8 步

```
✅ 01 四个场景标签都在
✅ 02~05 每场景：面板标题齐全、有真实数据、**webview/iframe = 0**、有可操作按钮
✅ 06 调度试算（fulfillment-triage · 总分 0.887 · 淘汰 29 个候选）与工作流校验（通过，0 问题）
✅ 07 场景助手真回答（deepseek-flash · 775 tokens · $0.00040 · 2116ms）
✅ 08 无渲染层报错
```

### 10.4 问题记录

| 现象 | 原因 | 处理 |
|---|---|---|
| 试算显示"无候选" | 接口返回字段为 `chosen`/`score`，代码读取 `agent_name` | 按真实字段读取，并显示淘汰候选数 |
| 工作流校验报 `[object Object]` | 422 的 `detail` 是对象，`String()` 变成 `[object Object]` | 主进程里对非字符串 `detail` 做 `JSON.stringify` |
| 校验一直失败 | 接口要求的是 `{graph:{entry,nodes}}`，传入了 `{nodes,edges}`（详情里节点在 `graph` 里） | 先取详情，再把它 `graph` 原样送去校验 |
| 治理场景助手面板点不到按钮 | 面板只占 1 行（约 120px），提示条被裁 | 面板加到 2 行；回归改成用输入框提问 |
## 11. 第六轮：设计器、新建表单、导出（收口）

### 11.1 工作流设计器（`am-designer`）

第 5 个场景「工作流设计」的面板独立完成编辑，不依赖任何外部编辑器：

- **画图**：读 `/workflows/{code}` 的 `graph`，按 `next`/`on_true`/`on_false` 做分层布局；
  节点是绝对定位卡片（按类型着色：开始绿 / 条件黄 / 审批红 / 智能体蓝），连线是 SVG 折线，
  `on_false` 用红虚线区分；
- **改图**：拖动节点摆位；点节点打开行内编辑器，可改类型、技能编码、智能体、条件表达式、
  审批角色、`next`、`input_from`；可加节点、删节点；
- **校验**：把当前图发给 `POST /workflows/{code}/validate`，就地显示通过/错误/警告；
- **发布**：`POST /workflows/{code}/versions`（带 changelog），角标从「未发布」变「已同步」；
- 顶部可在多个工作流之间切换。

设计器修改的是「图」，摆位仅影响本地显示（不写回 `graph`）：
**布局仅在视图层生效，`graph` 只保存结构**。

### 11.2 新建表单（`am-create`）

一个面板、三个页签（任务 / 技能 / 智能体），字段驱动：

| 页签 | 字段 | 提交 |
|---|---|---|
| 任务 | 标题、工作流（必选）、优先级、复杂度、所需能力、订单号 | `POST /tasks`（订单号进 `payload`） |
| 技能 | 编码、名称、分类、类型（内置/HTTP）、说明、函数名或接口地址 | `POST /skills`（按类型组 `builtin`/`http`） |
| 智能体 | 编码、名称、描述、阶段、模型档位、能力标签 | `POST /agents` |

按钮文案按页签区分（创建任务/创建技能/创建智能体），避免同一面板内同名按钮误点。

### 11.3 导出

| 面板 | 导出 |
|---|---|
| 任务 / 运行 / 审计 / 死信 / 技能 / 智能体 / 工作流 / 告警 | **CSV**（带 BOM，Excel 直开不乱码） |
| 运行趋势 | **CSV**（按小时）+ **PNG**（SVG → canvas → blob，不引第三方库） |

实现都在 `am-panels.js` 的 `toCsv / csvButton / exportSvgAsPng`，表格通过第 4 个参数
`{ filename }` 挂上导出条。

### 11.4 回归扩展到 12 步

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

### 11.5 问题记录

| 现象 | 原因 | 处理 |
|---|---|---|
| 创建任务 422 `workflow_code Field required` | 提供了「不指定」空选项 | 工作流改为必选，默认订单延迟闭环 |
| `priority` 传成字符串 | 数字输入框被创建为 `type=text` | `field()` 支持 `type: 'number'`，提交前再 `Number()` |
| 点「创建」点到智能体页签 | 三个页签按钮同名 | 文案区分（创建任务/创建技能/创建智能体） |
| 回归第 10 步点到了「导出 CSV」 | 导出条插在表格前，是面板里第一个 `.am-act` | 测试按文案精确点 |
## 12. 第七轮：反馈的 5 个问题（逐个修复 + 回归锁定）

| # | 反馈现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | DSH 引擎长期显示未就绪，用途不明 | 那是模板自带的「DSH 引擎」场景（供模板自身 AI 会话使用），复用外部引擎拿不到 token，因此始终"未就绪" | `retarget.js` 隐藏该场景标签 + 状态条 +「刷新对话」；本项目的 AI 面板为原生助手，不依赖引擎（**后续改为保留该场景标签**，见 §13.1、§20） |
| 2a | 点击运行条目后下方不显示信息 | 先 `show()` 概要、再 `show()` 步骤，第二次把概要覆盖了 | 抽屉增加 `append()`，步骤改为**追加** |
| 2b | 点「收起」后再点别的条目显示错误 | 收起时 `box.innerHTML=''` 把 `.am-drawer-body` 一起删了，之后 `show()` 往脱离文档的节点写 | 收起只隐藏 + 清空 body，容器保留 |
| 2c | 趋势图坐标轴与信息不全 | `viewBox 0 0 100 34` 太小、只画了 3 个文字标签、接口 `limit=300` 超上限（≤200）直接报错 | 重画：240×90 视口、纵轴 0/半/满刻度 + 横向网格、横轴每 6 小时刻度、柱高最小 1.5px；limit 改 200 |
| 3a | 下拉框白底白字看不清 | 原生 `<option>` 没继承主题色 | `select { color-scheme: dark }` + `option { background:#131722; color:#e6e8ee }` |
| 3b | 选哪个工作流都还是同一个 | 下拉只在首次加载时插入，任何重绘都被清空；且 `load()` 用 `meta.workflow || rows[0]` 覆盖了用户选择 | 下拉在 `draw()` 里每次重建；`load()` 优先用 `state_.code` |
| 3c | 设计器可读性差、过于复杂 | 横向分层在窄面板中向右溢出 | 改为**纵向**流程图（层=深度）、节点加大、加颜色图例 |
| 4 | 能力矩阵所有格子都标红"缺" | 接口里 `stages`/`categories` 的字段是 `code`，代码读取 `stage`/`category` → 键不匹配，全部落入"缺口"分支 | 改用 `st.code` / `cat.code` 组键（实测 32 格：26 有智能体、6 缺口） |
| 5 | 新建任务/技能失败（422 英文报错） | 必填项未填写即提交，接口返回 pydantic 的英文错误 | 提交前做**中文必填校验**（"还差这些必填项：任务标题"），必填字段标 `*` |

### 12.1 回归锁定的行为（17 步）

新增 5 步，对应前表 5 个问题：

```
✅ 07 矩阵按真实数据渲染：32 格 → 有智能体 26 / 缺口 6
✅ 08 运行详情：点开有明细 → 收起 → 再点另一条仍有明细（且两条内容不同）
✅ 09 趋势图：24 根柱 / 8 个刻度 / 3 条网格
✅ 10 新建表单：必填为空时给中文提示
✅ 11 设计器：切换工作流后标题与节点真的变（fulfillment_review → order_delay_exception）
```

### 12.2 附带修复

- 设计器连线标签引用了已删除的变量 `mx`，导致整块渲染失败（"加载失败：mx is not defined"）；
- 回归里 `page.waitForSelector('.tab')` 会命中被隐藏的引擎标签 → 改成等 `:visible`；
- 试算结果字段按接口真实返回读（`chosen`/`score`/`rejected`）。
## 13. 第八轮：刷新后面板丢失、启动落在引擎页、设计器连线

| # | 反馈现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 点击「刷新当前场景」后出现大量「未知面板类型」 | 模板的刷新会**重新注入 renderers.js**，脚本顶部 `var renderers = {}` 创建新对象，末尾再赋给 `window.APP_RENDERERS`；本项目注册在旧对象上 → 注册表替换后全部丢失 | 三个面板文件改注册到稳定对象 `window.__amPanels`；把 `window.APP_RENDERERS` 改成**访问器**，任何赋值都自动回填；每个文件注册完调 `window.__amSync()` |
| 2 | 进入工作台后首个界面仍为「DSH 引擎未加载」 | 模板的 `renderer/customer-start.js` 写死 `var FIRST = 'command'`（原作者的首场景）。本项目没有 `command`，回退到 `all[0]` = 引擎场景 | `FIRST = 'overview'`（工作台总览） |
| 3 | 设计器连线显示错误 | ① 使用写死的 `a.y + 52` 作为卡片高度；② SVG 的 `viewBox` 用内容尺寸（396×677）却被 CSS 拉伸到整个画布宽度 → 坐标横向放大 3 倍，连线全部偏移到卡片右侧 | ① 节点插完**下一帧**量 `offsetLeft/Top/Width/Height`；② `viewBox` 改成画布真实像素（`clientWidth × 内容高`），1 单位 = 1px；末端加箭头，条件是/否标在线上 |

### 13.1 关于「DSH 引擎」场景

> **已过期（第十二轮起，2026-11-23 校注）**：独立引擎已装好（§16），`harness` 面板不再是"永远未就绪"——
> 总览中即有「DSH 会话」面板（§20）。并且**「DSH 引擎」整个场景的标签后续改为保留**：引擎由工作台
> 自行拉起、能抓到 token，即真实的 DSH 会话入口（`retarget.js` 中"未就绪即隐藏"那段因标签上没有
> `data-am-hide-when-down="1"` 而实际不生效）。以下为第八轮当时的状态。

该场景为模板自带的**引擎主界面**：原作者用其 DSH 会话实现"每个场景一个 AI"。
本项目做法不同：AI 面板为原生助手（`/workbench/ask`），不依赖该引擎。

**当时未做成自启动的原因**：模板启动引擎须满足以下之一：
① 本地有 `引擎\apps\cli\lib\bin.js`（本机是打包安装的 DSH，没有这个目录）；
② 复用已在运行的实例——但复用拿不到它的启动 token（`?token=`），面板只会显示"未就绪"。
因此隐藏优于保留一个始终失败的页面；后续装好独立引擎目录后，去掉 `retarget.js` 中的
`hideEngineBits()` 即可恢复。

### 13.2 回归扩展到 18 步（该轮为 18 步；2026-11-23 新增设计器用例后为 19 步，见 §22）

新增两步锁定该轮问题：

```
✅ 01 启动落地 overview（引擎标签已隐藏）—— 之前的「引擎页」问题
✅ 07 点「刷新当前场景」后：5 个面板、注册表 16 个原生类型、0 个「未知面板类型」
```

> **后续变更**：工作台自行拉起引擎并能抓到 token 后（§16），引擎标签不再隐藏
> （第 01 步中"引擎标签已隐藏"为当时状态）；当前第 01 步断言的是
> "启动落地 `overview` + 「DSH 引擎」标签**存在**"，见 §13.1、§20.5。

### 13.3 经验与约束

- **热重载会换对象**：任何向第三方注册表写入内容的实现，都需考虑"表被替换"的情况，
  否则点击一次刷新即还原为原始状态；
- **坐标要对齐两套坐标系**：SVG 的 `viewBox` 单位 ≠ 页面像素，除非严格相等；
  测量必须等布局完成（`requestAnimationFrame`），否则拿到 0。
## 14. 第九轮：连线对齐、模板规范对照、清理冗余

### 14.1 设计器连线与节点卡片分离的原因

原因是两个坐标问题叠加：

1. 节点卡片的 `offsetTop` 是**内容坐标**（可滚动画布内的绝对位置），
   而 SVG 用的是 `clientWidth/clientHeight`（**可视区**尺寸）+ `inset: 0` ——
   超出第一屏的节点，它的线被画到了视图外面；
2. 画布可滚动时 `viewBox` 与内容尺寸不一致，缩放后线与方块错位。

修法：SVG 的 `width/height` 直接设成**内容尺寸**（`max(可视宽, 最右节点) × max(可视高, 最下节点)`），
`viewBox` 与像素 1:1；CSS 改成 `left/top: 0; width/height: auto`（不再 100% 拉伸）；
拖动时用 `requestAnimationFrame` 节流重画，箭头跟着方块走；箭头方向按最后一段判断（目标在上就朝上）。

验证脚本（实测）：8 张卡片 / 8 条连线 / **8 条端点全部落在卡片底边中点与目标顶边中点**（误差 < 1.5px），
画布内容高 661 > 可视高 552 —— 修复前，位于这 109px 区间内的节点丢失连线。

### 14.2 模板规范对照

模板的《场景配置格式》要求：

| 规范 | 本项目情况 |
|---|---|
| `scenarios/<id>.json`，**文件名必须等于 id** | 已符合：5 个场景全部一致 |
| 必填：`id` / `name` / `panels[]`（每个面板 `id`/`title`/`type`） | 已符合 |
| `layout: "grid"`、`theme: "dark"` | 已符合 |
| 面板坐标不得超出 `cols`（否则网格长出隐式列、比例错乱） | 已符合：5 个场景最大使用第 4 列 |
| 面板类型必须已注册到 `APP_RENDERERS` | 已符合：18 个原生类型 / 20 个原生面板全部注册（`am-dsh` 保留注册但已无场景使用） |
| 面板自刷新要有 cleanup | 已符合：`am-kpi/runs/approvals/alerts/chart/deadletters` 均 `return () => clearInterval(...)` |
| 场景 JSON 不带 BOM | 已符合：校验脚本会报错 |
| `_场景身份索引.md` 与场景同步 | 已完成：已重写为本项目的 5 个场景 |
| 场景记忆在 `引擎数据\.dsh\场景记忆\<场景>\`（§〇 交接 ≤4KB） | 已完成：已换成本项目的 5 个场景骨架 |

**有意偏离的一条（第十二轮起已部分回归）**：模板为 AI 面板配置 `harness`（绑定 DSH 会话），当时需要 `引擎\` 目录与引擎 token，
本机两者均不可得。因此改用 `am-assistant`（原生助手，走 `/workbench/ask`）：
功能等价且不依赖引擎；代价是**没有"会话"概念**，场景记忆不再自动注入助手
（助手读取后端实时快照）。第十二轮装好独立引擎后（§16），总览已使用真实 `harness` 面板（§20）；
各场景曾保留 `am-assistant` 作为"场景助手"，因其定位是"带实时快照的简短结论"，而非长会话。
**2026-11-24 起这条偏离已收回**：每个场景都有真 `harness`（§24），「场景助手」面板随之删除（§25）。

### 14.3 清理项

| 项 | 处理 |
|---|---|
| 作者个人素材：启动视频 15MB、B站/党建/徽章图标 | 已删（17.7MB → 2.4MB） |
| `启动.vbs`（UTF-8 中文会被 WSH 拆坏） | 删除，改 `start.cmd`（纯 ASCII）+ `scripts/launch.cjs` |
| `外壳/scripts/`：`建会话 / 换会话 / 归档会话 / 会话改名 / check-gui`（DSH 会话专用） | 删除（无残留调用） |
| 原场景：命令 / B站 / 自我复盘 / 本地电脑（json + context md） | 删除，换成本项目的 5 个 |
| 原场景记忆骨架（4 个场景目录） | 删除，换成本项目的 5 个 |
| `说明/使用说明.md`（原作者的产品说明） | 重写为本项目的 |
| `引擎数据\.dsh\` 里 AI 会话/技能样例 | 保留骨架（模板的记忆方法论仍在用） |

**保留但未使用的**：`renderers.js` 里 `pc-*` / `review-*` / `bl-*` / `site-*` / `webai` 等渲染器约 1MB。
未删除的原因：它们是模板的一部分、相互引用较多，删除易连带中断；后续如需"本地文件""预览"
类面板可直接复用。文档中标注"未使用"，避免误认为由本项目编写。

### 14.4 新增：`agentmatrix-workbench/README.md`

将"哪些为模板原版、哪些为自研、哪些未使用"整理为目录表，便于后续维护时确认边界。
## 15. 第十一轮：把 DSH 找回来（方向修正）

### 15.1 早期判断的偏差

阅读模板的 `00-核心机制`（协作 / 记忆 / 场景体系）后可确认该工作台的设计前提：

> **DSH 是大脑**：一个场景 = 一类反复回来的活 = 一个 DSH 会话；记忆必须是文件（会话会被换掉）；
> 会话之间靠派单/回执协作。
> **界面只是手和眼**：壳负责摆面板、记状态、把人的动作递进去。

当时把 AI 替换为自研的一次性调用（`/workbench/ask`），既无会话，也无记忆注入与派单回执，
导致 **DSH 在界面上消失**，这也是"看不出与 DSH 有关"的原因。

### 15.2 实际的连接点（原本存在但未在界面露出）

`dsh-plugins/agentmatrix-tools/` 是一个 **DSH 插件**，已装进当前 profile
（`~/.dsh/profiles/desktop/package.json` 的 bundles 里有 `dsh-agentmatrix-tools`），
它向 DSH 注册 4 个工具：

| 工具 | 作用 |
|---|---|
| `agentmatrix_create_task` | 在平台发起任务并返回调度决策 |
| `agentmatrix_run_status` | 查某次运行的状态与步骤 |
| `agentmatrix_explain_dispatch` | 解释为什么派给这个智能体 |
| `agentmatrix_matrix_coverage` | 看矩阵覆盖与缺口 |

即：**在 DSH 中描述任务（如"订单 SO-xxx 延误，建 P1 任务"），DSH 调用工具将任务落到平台**，
平台执行工作流 → 工作台面板可见任务、运行、审批与审计。该链路原本可用，
但界面上没有任何位置说明其存在。

### 15.3 该轮变更

1. **插件打来源标记**：`agentmatrix_create_task` 写入 `payload._source='dsh'`（含工具名与时间），
   任务面板新增「来源」列（DSH / 界面），**可直接看出任务来源**；
2. **新面板「DSH 大脑」**（工作台总览右下；2026-11-23 已按反馈删除，见 §20.8）：
   - 三层关系卡片：DSH 大脑（会话·文件记忆·派单回执）/ AgentMatrix 执行器（工作流·智能体·调度·审计）/ 壳；
   - 状态标签：插件是否已装进 DSH、来自 DSH 的任务数；
   - 4 个工具清单 + **一句可复制的话术** + 「打开 DSH 会话」按钮；
3. 端到端实测：带 `_source=dsh` 建任务 → 平台返回任务 id，任务面板「来源」显示 **DSH**，
   「DSH 大脑」面板统计变为 1 条。

### 15.4 尚未完成的一步（第十二轮已补上，见 §16）

> **已过期**：引擎已装进 `引擎\`，总览的「DSH 会话」面板即该步的落地（§16.3、§20）。
> 当时的判断保留如下。

模板给每个场景配的是 `harness` 面板（内嵌 DSH 会话，靠 `sessionTitle/sessionId/pinTarget` 钉住）。
要用它，必须让工作台**自己拉起引擎**（`引擎\apps\cli\lib\bin.js`）或**拿到运行中实例的 token**——
本机为打包安装的 DSH，两者均不可得，当时的状态是"工作台看数据 + DSH 在另一窗口作为大脑"。

要补上这一步，只有两条路：
1. 装一份独立的 DSH 引擎目录到 `引擎\`（模板原生支持，装好即用）；
2. 或者让主进程获取运行中实例的 token（需修改其取 token 逻辑）。

在此之前，至少保证**关系可见、可解释、可验证**：插件状态、来源列与话术示例均在界面上。
## 16. 第十二轮：把 DSH 引擎真正装起来（工作台自己拉起它）

### 16.1 安装内容

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
| 引擎静默退出 | 模板用 `引擎\apps\cli\lib\bin.js` 作入口，曾放置一个 `import()` shim 转发 —— 但引擎按 `argv[1]` 定位自身资源，经 shim 后找不到资源且无报错退出 | `main.js` 的 `CLI_BUILT` 改成一个**候选列表**：优先 `引擎\node_modules\@deepseek-ai\dsh\lib\bin.js`，其次才是 `apps\cli\lib\bin.js`；删掉 shim |
| `engine start failed`（profile 找不到） | `main.js` 把 `DSH_HOME` 指到 `引擎\.dsh`，那里没有 profiles | `scripts/launch.cjs` 传 `DSH_CUSTOMER_HOME=%USERPROFILE%\.dsh`（复用已安装的 profile 与插件） |
| 端口被自己占用 | 之前为了复用外部实例把 `DSH_PORT` 设成 58360 | `工作台配置.ini` 改回 `DSH_PORT=3083`（工作台自己的引擎） |

> **第 2 行已过期**：第十二轮临时把 `DSH_CUSTOMER_HOME` 指到 `%USERPROFILE%\.dsh`；第十四轮起改用
> 工作台专用家目录 `引擎\.dsh`（§18.1），`scripts/launch.cjs` 不再默认指向用户目录。

### 16.3 实测

```
[boot] direct: node ...\引擎\node_modules\@deepseek-ai\dsh\lib\bin.js web --no-open --port 3083
engine ready in 13.2s via 内置入口
[token] captured: LtiHj4DGS6UNDxJawh5oUOXGgkTjVK7wNKR61ZNIWEI
[out] dsh web: http://127.0.0.1:3083/?token=...
```

- `window.app.isHarnessReady()` → **true**
- `getHarnessUrl()` → `http://127.0.0.1:3083/?token=***`
- 「DSH 引擎」场景打开即**真实的 DeepSeek Harness 界面**（工作区中可见本项目的文件与会话）
- 工作台总览新增「DSH 会话」面板（`type: harness`，`sessionTitle: 工作台总览`），
  "一个场景一个 DSH 会话"的模型首次落到界面上

### 16.4 换台机器怎么装

> **已过期（2026-11-23 校注）**：本节仅对应第十二轮"装引擎"一步。当前干净克隆的完整首次安装
> （平台 `.env` → 外壳 Electron → 引擎依赖 → `setup-dsh-home.cjs` 生成家目录）见
> [`agentmatrix-workbench/README.md`](../agentmatrix-workbench/README.md) 的「首次安装」；
> DSH 家目录也已改为 `引擎/.dsh`（§18），不再默认 `%USERPROFILE%\.dsh`。

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

- 引擎与工作台共用同一个 `~/.dsh`：**工作台内的 DSH 与桌面端为同一套**（会话、插件、技能均在）。
  优点是插件（`dsh-agentmatrix-tools`）与历史会话可直接使用；代价是两者共享上下文。
  需隔离时可将 `DSH_CUSTOMER_HOME` 指向单独目录，但需重装一次插件。
- 引擎的 5 个原生依赖（koffi / node-pty 等）安装脚本被 npm 拦截，web 模式不需要它们；
  后续如需终端类功能，需 `npm install-scripts approve` 后重装。
## 17. 第十三轮：深色融合、启动门兜底、后台语义

### 17.1 DSH 界面为亮色，与工作台不协调

**原因**：DSH 的 Web UI 跟随 `prefers-color-scheme`（`ui-theme` 插件：`system/light/dark`），
而工作台自身为深色 ⇒ 嵌入后明暗混杂。

**做法（融合，不追求完全一致）**：
1. `main.js` 启动时 `nativeTheme.themeSource = 'dark'` —— 整个应用（含 webview）的
   `prefers-color-scheme` 变深色，DSH 界面随之变深；
2. `web-contents-created` 里对每个 webview 注入一小段 CSS，只调"接缝处"：
   `color-scheme: dark`、滚动条样式、`::selection` 颜色 —— 不改它的布局与组件；
3. 工作台自身配色（`#0b0d12` / `#4f8cff`）保持不变，两侧以"同为深色 + 同一套滚动条/选中色"实现融合。

恢复 DSH 自身浅色的方式：在 DSH 设置 → 外观中修改，或删除 `main.js` 中的 `nativeTheme` 行。

### 17.2 启动卡在「引擎已就绪，正在加载界面 92%」

> ⚠ 2026-11-23 复查：本节原写的"原因是 SPA 首屏十余秒"**不是真正原因**，原兜底也从未生效。
> 真实原因与最终修法见 §22（第二十二轮）。结论先放在这里：92% 是**主进程宣布就绪、渲染层认为没就绪**
> 的分叉点，与 SPA 渲染快慢无关。

**原因（初版判断，已被 §22 推翻）**：模板的启动门等待 harness（内嵌 DSH）上报"页面就绪"。
内嵌 DSH 为完整 SPA，首次加载需十余秒，超时即停在 92%。「立即进入」按钮本为该场景的官方出口
（模板注释说明"等同切换场景再切回"）。

**改法（初版，实际无效）**：`retarget.js` 加 `autoEnterWhenStuck()`：页面停在"加载中"超过约 16 秒
即自动点击「立即进入」。—— 该函数按"页面文字里有没有'加载中'"判断，且**一次判否就永久退出**；
而启动前 7 秒的文案是「检查引擎状态… / 正在启动 Harness 引擎…」，2 秒后的第一跳就判成"没卡住"，
于是这个兜底从来没被触发过（§22 重写）。

### 17.3 关闭工作台后任务是否继续

**不会继续。** 依赖关系如下：

```
workbench（Electron）
  └── DSH 引擎（node 子进程，3083）  ← 会话进程位于此层
        └── 会话 / 工具调用
```

- 工作台关闭 → 引擎子进程被杀 → **会话结束**，正在运行的对话与工具链随之中断；
- 但**已派到平台的任务不会中断**：任务执行在 Docker 中的 worker（`apps/worker`），
  工作台与引擎仅为"发起方"。关闭工作台后，工作流仍会跑完，审批节点等待下一次处理；
- 需 AI 长时间执行时，应**通过 DSH 工具将任务派给平台**（`agentmatrix_create_task`），
  或使用平台的定时/批处理，而非保持窗口开启。

### 17.4 全部面板 `fetch failed` 与对话卡顿

- `fetch failed` = 平台容器被 WSL 回收（闲置会停止）。`dev up` 拉起后恢复；
  常驻会话可避免再次被回收（`scripts\dev.ps1 up` 会起一个 keepalive）。
  打开工作台即自动探活并拉起平台（见 §20.4），无需手动 `dev up`。
- 卡顿：面板原为各自轮询（15/20/25/30 秒），叠加对话的长上下文后相互抢占。
  轮询已统一放宽到 **30–45 秒**；上下文较长时**新开会话**可明显改善响应速度
  （上下文长度是主要成本）。
## 18. 第十四轮：内嵌的 DSH 改成"项目专用"

该轮要求：**内嵌 DSH 不应与桌面端一致，应只在本项目目录工作并去掉无关功能。**

### 18.1 做法：分开的 DSH 家目录 + 专用 profile

| 项 | 之前 | 现在 |
|---|---|---|
| DSH 家目录 | `%USERPROFILE%\.dsh`（桌面端在用：毕业设计 / 学生工作对接 / 多媒体技术 三个工作区） | `agentmatrix-workbench\引擎\.dsh`（工作台专用） |
| profile | 官方 `web` | 自定义 `workbench`（由官方 web 模板复制而来，见 `引擎/.dsh/profiles/workbench/`） |
| 工作区 | 3 个 | **1 个**：本项目根目录（`storages/workspace.json` 预置；脚本按克隆后的实际路径写入） |
| 模型 | 桌面端配置 | 凭据从 `~/.dsh/.credentials.yaml` 复制；profile patch 里写死 `deepseek-account / deepseek-flash / high` |
| 启动参数 | `dsh web --no-open --port` | `dsh workbench --no-open --port`（`main.js` 的 `WORKBENCH_PROFILE`，可用环境变量 `DSH_PROFILE` 覆盖） |

实测（不动正在用的会话，另起 3086 验证）：

```
node 引擎\node_modules\@deepseek-ai\dsh\lib\bin.js workbench --no-open --port 3086
→ dsh web: http://127.0.0.1:3086/?token=...   （401 without token = 鉴权正常）
```

### 18.2 未直接修改界面的原因

DSH 的界面由几十个 client 插件组成（`ui-workspace` / `ui-sidebar-*` / `ui-plugin-market` …），
"新建工作区""插件市场"这类入口是插件注册的。真正移除需在 profile 的
`cordis.patch.yml` 中按 **loader row id** 写 `disabled: true`；row id 不在文档中，
需先用 `dsh workbench --dump-config` 导出后逐条确认。

未按猜测的 id 强制关闭（误关会破坏界面），该轮只处理**确定性最高**的部分：
工作区收为一个、profile 独立、模型配置固定。**后续步骤**：

```bat
cd agentmatrix-workbench\引擎
set DSH_HOME=%CD%\.dsh
node node_modules\@deepseek-ai\dsh\lib\bin.js workbench --dump-config > ..\..\docs\profile-dump.yml
:: 从里面找 ui-workspace / ui-plugin-market / ui-sidebar-browser 等行，拿到 id，
:: 再在 引擎\.dsh\profiles\workbench\cordis.patch.yml 里加：
::   - id: <row-id>
::     disabled: true
```

### 18.3 未完成的安装项

`dsh-agentmatrix-tools`（本项目的 4 个工具）**当时尚未装入该 profile**：
`dsh plugin --profile workbench add ...` 依赖 pnpm，本机未安装。补充安装步骤：

```bat
npm install -g --allow-scripts=pnpm pnpm
cd agentmatrix-workbench\引擎
set DSH_HOME=%CD%\.dsh
node node_modules\@deepseek-ai\dsh\lib\bin.js plugin --profile workbench add link:<仓库根>\dsh-plugins\agentmatrix-tools
```

在此之前，工具调用仍可在**桌面端 DSH**（原 profile）中使用；工作台内嵌引擎当时仅有对话能力。

> **现状（2026-11-23）**：第十五轮已把这件事写进 `setup-dsh-home.cjs`（§19.2），脚本会自动执行
> 同样的 `plugin --profile workbench add link:`（`<仓库根>` 由脚本按实际路径填）；干净克隆只需运行一次脚本。

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
2. 写 `workbench` profile（官方 web 模板结构 + 本项目的模型配置）；
3. 预置**唯一工作区** = 本项目根目录（`storages/workspace.json`）；
4. 从 `~/.dsh` 复制凭据（模型可用）；
5. 若有 pnpm，把 `dsh-agentmatrix-tools` 装进该 profile。

### 19.3 已按真实 row id 裁掉的入口

row id 来自 `dsh --profile workbench --dump-config`（不猜）：

| row id | 插件 | 为什么关 |
|---|---|---|
| `tool-plugin-market` | `dsh-plugin-market/tools` | 本项目只使用自研插件，不需要插件市场 |
| `ui-sidebar-browser` | `dsh-client-ui-sidebar-browser` | 工作台自身即外壳，不需要再嵌入浏览器 |

实测：裁剪后 `--dump-config` 仍能正常解析（46KB，3 处 `disabled: true`），
引擎在 3087 端口正常启动并打印 token。

### 19.4 保留但可继续裁剪

`ui-workspace`（侧栏工作区列表，"新建工作区"按钮在它里面）、`ui-jobs`、`ui-schedule`、
`ui-sidebar-files`、`ui-sidebar-terminal`、`ui-deliverables`。
未整体关闭的原因：`ui-workspace` 同时负责会话分组，关闭侧栏会一并消失；
若只去掉"新建工作区"按钮，需修改其组件（涉及 DSH 源码层），或用注入脚本按文案隐藏。

## 20. 第十六轮：平台自启动 + DSH 会话面板布局修复（2026-11-23）

> 编号沿用正文顺序（上一节为 §19 第十五轮）。该轮两件事互不相关，但都属于"打开即可用"的问题。

### 20.1 现象：DSH 会话面板输入框随输入向左偏移

总览的「DSH 会话」面板（`ov-chat`，`type: harness`）里：

- 面板宽 715px 时，会话列只占 **314px 且贴在右侧**，左边空出 **401px** —— 表现为"输入框缩在右侧"；
- 输入框未随面板铺满；每多输入一个字符，输入框左边界向左移动，文本越长越明显；
- 拉宽窗口、点击「刷新当前场景」均不自愈（重新注入后依旧）。

### 20.2 根因：三列显式摆位 + 单轨道 ⇒ 生成隐式自动列

引擎的 AppFrame（`dsh-client-ui-layout` 的 `AppFrame.module.css`）把三列**显式摆位**
（以下为示意，实际为 CSS Modules 的类名）：

```
sidebarCol   → grid-column: 1
centerCol    → grid-column: 2
rightbarCol  → grid-column: 3
```

精简模式原将 grid 压成**一条轨道** `minmax(0, 1fr)`。第 2/3 列没有显式轨道可落，
CSS Grid 按 `grid-column` 自动**生成隐式列**：隐式列按内容宽度撑开，剩余空间全部分配给第 1 列 ⇒
会话列被推到右侧；输入框随内容变宽时隐式列继续增长，左边界持续向左偏移。

即：**子项用 `grid-column:2/3` 摆位时，轨道数必须保留三条**；少一条不会省掉两侧，
而会多生成两条隐式列。

### 20.3 修法：`0px minmax(0, 1fr) 0px`

保留三条轨道并将两侧压成 0，中间那条才是真正的 `1fr`：

```css
[style*="grid-template-columns"][style*="minmax(0"] {
  grid-template-columns: 0px minmax(0, 1fr) 0px !important;
}
```

JS 兜底（React 重渲染会把内联样式顶回去）改同一行：

```js
f.style.setProperty('grid-template-columns', '0px minmax(0, 1fr) 0px', 'important');
```

**两份常量必须同步**，否则一条链路修复后另一条仍会回退：

| 文件 | 常量 | 用在哪 |
|---|---|---|
| `外壳/main.js` | `HARNESS_CHAT_CSS` / `HARNESS_FIX_JS` | 主进程 IPC `harness:wv:inject`（渲染层调用）：`insertCSS` + `executeJavaScript`，另有常驻 MutationObserver/定时器兜底 |
| `外壳/renderer/renderers.js` | 同名两份（内容一致） | 渲染层 `renderers.harness` 自己的注入路径（同一面板的第二个保险） |

两侧压成 0 之后仍然 `display: none`（`[data-side="sidebar"]`、`[data-side="details"]`、
`[data-width-handle]`、`[data-phase] > header`），因此**视觉结果不变**：仅剩会话列与输入框，
此时它们占据真正的 `1fr`，不再依赖隐式列生成。

### 20.4 平台自启动：打开工作台就有平台

此前需先手动 `dev up`，否则面板全部 `fetch failed`。当前（2026-11-23 新增）流程：

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
- **面板请求会等平台就绪**：`am:get / am:post` 前先 `waitPlatformReady()`，冷启动时面板多等待一段时间，
  不会先连续抛出 `fetch failed`；
- **关闭平台自启动**：设置 `AM_PLATFORM=0` 后运行 `start.cmd`，启动页该行留空（不再自动启动平台），
  仅复用已手动启动的实例（`AM_HEALTH` 可修改探测地址）；
- 平台冷启动通常 10–60 秒（WSL 发行版首次启动 + 容器 healthy 需要时间）；它和引擎启动**并行**，互不阻塞。

### 20.5 验证方式（可复核）

1. **真实 DSH 页对照**：用系统 Edge（Playwright）直接打开 `http://127.0.0.1:31238/chat`（保活入口，经 3083 引擎，
   不经过 Electron），视口分别取 715×718 与 1252×1257；向页面注入单轨道 `minmax(0, 1fr)` 后即可复现
   "会话列贴右、左侧留 401px"（1252 宽时为 938px 空白），再注入 `0px minmax(0, 1fr) 0px` 即恢复正常。
   该结果说明问题出在"轨道数"，与 Electron 容器无关；
2. **隔离实例截图**：复制一份外壳到 `外壳-test`（独立 userData，复用同一引擎），只加载同一段注入代码，
   注入后的诊断从 `centerCol x=235 w=480` 变成 `centerCol x=0 w=673`，前后各截一张；
3. **平台自启动逻辑单独跑两条路径**（把 main.js 里那段原样抽出来、用假 dev.cmd 驱动）：
   - 成功路径：假健康检查 2 秒后才通 → `ensurePlatform()` 约 3.0s 返回 ready，并完整发出
     `check → starting → starting(Ns) → ready` 事件；
   - 失败路径：假 dev.cmd 退出码 3 → 约 9 秒判 failed 收工（不会让面板空等满 3 分钟）；
4. **回归**：`node tests/e2e/workbench.mjs`，**18 步**全部通过（5 个场景各 1 步 + 13 个功能步）。
   - 第 01 步：五个场景标签都在、启动落地 `overview`、**「DSH 引擎」标签保留**（不再要求它隐藏）；
   - 每场景那几步断言 **20 个原生面板里 `webview/iframe = 0`**，而「DSH 会话」面板**允许且仅允许 1 个 `webview`**；
   - 运行方式：工作台退出后直接跑；工作台开着时用 `set WB_SHELL_DIR=agentmatrix-workbench\外壳-test`
     指向隔离外壳副本，再跑同一条命令。

### 20.6 当前实测基线（2026-11-23）

| 项 | 数字 |
|---|---|
| 工作台 | 5 个场景 / 21 个面板 = **20 个原生面板**（18 种渲染器注册、17 种在用）+ **1 个「DSH 会话」harness webview** |
| 面板分布 | 总览 6 · 工作流设计 2 · 能力矩阵 4 · 交付追踪 3 · 治理与策略 6 |
| （2026-11-24 后） | **16 个原生面板 + 5 个「DSH 会话」= 21 面板**：总览 5 · 工作流设计 2 · 能力矩阵 4 · 交付追踪 4 · 治理与策略 6（见 §25） |
| 启动 | `start.cmd` → `scripts/launch.cjs` → Electron；落地 `overview`（`customer-start.js` 的 `FIRST`）；「DSH 引擎」场景标签保留在最前（真会话入口，固定不可拖） |
| 引擎 | `工作台配置.ini` 的 `DSH_PORT=3083`；监听就复用，没跑就自己拉起（profile=`workbench`，`DSH_HOME=引擎/.dsh`） |
| 平台 | 自启动（探 `/health` → `dev.cmd up`），`AM_PLATFORM=0` 可关 |
| 平台数据 | 接口 52 条路径 / 60 个操作；单测 102（宿主机）/ 128（容器）；业务 E2E 17 步；路由冒烟 18 页；矩阵 26/32 = 81.25%；4 条工作流；种子智能体 / 技能各 15；真实运行实验 8 条 / $0.0056 |
| 回归 | **18 步**（5 个场景各 1 步 + 13 个功能步）；刷新后原生类型注册表 18 个 |
| 版本 | DSH 0.2.2-rc.5 · Electron 43.4.0 · 工作台 0.2.1-rc.3 |

### 20.7 该轮结论

- **Grid 的隐式列是静默故障**：不报错，只是位置不对，而且会随内容宽度漂移 ——
  子项带 `grid-column` 时，轨道数必须与最大列号一致；
- **同一份注入常量有两个副本时，改一处等于没改**（主进程 + 渲染层各一份）；
- **"启动需几步"是可用性问题**：能自动探活并拉起时，不应要求使用者在文档中背命令。

### 20.8 补记（2026-11-23）：删除总览的「DSH 大脑」面板

2026-11-23 根据使用反馈移除：总览右下角的「DSH 大脑」面板遮挡场景助手、信息重复。

- **原因**：`ov-dsh` 位于 col4 / row3 / w1 / h2，而 `ov-ai` 为 col2 / row3 / w3 / h2，
  在 CSS Grid 中两块**重叠**，DSH 大脑覆盖场景助手右侧 1/3，表现为覆盖在助手之上的小窗；
  其内容（DSH / 执行器 / 壳三层关系、4 个工具、话术）对日常操作没有增量。
- **处理**：从 `scenarios/overview.json` 删掉 `ov-dsh`。总览 7 → 6 个面板，
  场景助手恢复整行宽度（实测 1360px 宽的网格里 x=353、w=1017），布局不再有遮挡。
- **保留**：`am-dsh` 渲染器代码仍在 `am-panels2.js` 并注册（原生类型仍 18 种，当前场景用到 17 种），
  只是没有场景使用；后续若需恢复，只需在场景 JSON 中重新写入一块面板配置。
- **回归**：`tests/e2e/workbench.mjs` 第 02 步新增断言「总览不再出现 DSH 大脑」；
  全量 18 步复跑通过。文档里的面板口径统一改成 **5 场景 / 21 面板 = 20 原生 + 1 DSH 会话**。

## 21. 第十七轮：新对话自动接项目进度 + 切换/加载的淡入淡出（2026-11-23）

> 该轮解决两个使用体验问题：新 DSH 对话需人工反复交代项目背景；界面切换与加载为硬切。

### 21.1 新对话未接上进度的原因

工作台的 DSH 引擎用的是 `workbench` profile，它由 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`
+ 本项目的插件组成。`dsh-web-app` 的 `cordis.patch.yml` 默认关闭了 **`agent-instructions`**：

```yaml
- id: agent-instructions
  disabled: true
```

因此即使项目根目录存在 `AGENTS.md`，新会话也不会自动加载，每个对话均从零开始。

### 21.2 做法：重新启用 + 一份"开工须知"

1. 在 `引擎/.dsh/profiles/workbench/cordis.patch.yml` 末尾重新打开（profile 补丁层优先级最高）：

   ```yaml
   - id: agent-instructions
     disabled: false
   ```

2. 仓库根新增 [`AGENTS.md`](../AGENTS.md)：只记录新会话必需的信息：
   - **开工顺序**：先读 `docs/HANDOFF.md` → `git status` / `git log` → 按任务读专题文档 → 需要活数据时查询 API；
   - **当前基线**（带日期）：接口 52/60、19 表/11 迁移、订单 65,752、矩阵 26/32、运行/测试规模等；
   - **工作纪律**：改代码同步文档、跑单测/E2E、编码规则、不编数据、工作台面板约定；
   - **常用入口**：`dev up` / `dev ps` / `start.cmd` / 端口 / 演示账号。

   加载链：项目根以 `.git` 标记（`projectRootMarkers` 默认 `['.git']`），
   会话工作区 = 本项目根目录（`setup-dsh-home.cjs` 写入的实际路径），因此根目录该文件会被命中；
   用户级 `$DSH_HOME/AGENTS.md`（引擎/.dsh/AGENTS.md）无需放置，项目级文件已足够。

3. `scripts/setup-dsh-home.cjs` 同步写入这条 profile 配置，确保重建 DSH 家目录时不会被覆盖回 `disabled: true`。

**维护规则**：项目状态变更后，除 HANDOFF 外还需同步 `AGENTS.md` 的「当前基线」；
新对话首先仍应读 HANDOFF（`AGENTS.md` 只提供入口与底线，不复制全部细节，避免两份真相源冲突）。

### 21.3 切换/加载的过渡动效

> 第一版使用 Chrome View Transitions（仅对 `#grid` 命名做交叉淡化），实测仍有闪烁：
> View Transition 只淡化 DOM 快照，新场景先显示「加载中」占位，数据到达后仍二次跳变；且 0.2s 交叉淡化
> 不足以覆盖"旧场景 → 占位 → 数据"三段变化。**第二版改为"遮罩"**，同时覆盖换 DOM 与等数据两个阶段。

| 位置 | 做法 | 时长 |
|---|---|---|
| 场景切换（总览 ↔ 设计 ↔ 矩阵…） | ① 给 `#scenario-view` 加 `#scene-veil` 遮罩并淡入；② **等遮罩完全不透明（≈210ms）再换 DOM**（否则旧场景在半透明时被清掉，仍会闪一下）；③ 等面板的「加载中」消失且 `window.am.pending() === 0`（preload 统计未完成请求数）；④ 遮罩淡出 | 进 200ms / 至少盖 280ms / 出 220ms |
| 面板「加载中 → 数据」 | MutationObserver 监听 `.panel-body`：移除过 `.am-state` 后首次出现内容时，`body.animate()` 淡入；轮询刷新不触发 | 200ms |
| DSH 会话 webview | `renderers.harness` 在 `dom-ready`/`did-finish-load` 后加 `.ready`，CSS `opacity 0→1` | 250ms |
| DSH 引擎页 ↔ 场景页 | ① 两个 `.view` 放进 `#views`、绝对定位叠放并**始终挂载**（不用 `display:none`，否则 webview 会被卸载/重载）；② 场景侧用 `#view-veil` 盖住并淡入；③ 引擎侧在 guest 文档里注入 `#__wbFadeVeil` 全屏黑幕，先全黑再淡出/淡入（HTML 遮罩盖不住 webview 这种 guest 视图）；④ `showView` 用 `inert` 关掉非当前页的焦点/交互 | 场景侧 210ms 进 / guest 220–260ms 淡出 |
| 开机加载页 | ① `body.booting` 期间 `#harness-webview { visibility: hidden }`（guest 视图偶发会盖到遮罩上，表现为加载中闪 0.1s）；② `__bootFinish` 先让落地场景在遮罩后渲染（`__dshPickLanding`），260ms 后再淡出；③ 淡出完成后才解除 `booting` | 260ms + 500ms |

- 使用 `window.am.pending()` 的原因：面板各自 fetch，没有统一"就绪"回调；在 preload 中对所有 `am:*` 请求计数，
  比"观察占位文字"更准确（部分面板加载时没有 `.am-state`）。
- **为什么「DSH 引擎」以前没有淡入淡出**：它不只是另一个 HTML 页，里面是 `<webview>`。两个坑叠在一起：
  ① `loadHarness` 用 `webview.getAttribute('src')` 和 `getHarnessUrl()` 比较，而 webview 预置的是引擎直连
  （`:3083/`）、`getHarnessUrl()` 返回站点代理（`:31238/chat`）⇒ 每次点「DSH 引擎」都重设 src、整页重载，
  先闪 "Loading plugins…"；② `.view{display:none}` 会让 guest 卸载。现在改为：webview 只加载一次
  （`getURL()` 已是 http 就跳过设 src）+ 两个 view 分层常驻 + guest 黑幕淡入淡出。
- 降级：`prefers-reduced-motion: reduce` 时遮罩不做过渡；极小/隐藏窗口仍按原逻辑渲染。

### 21.4 验证

- `--dump-config` 里 `agent-instructions` 为 `disabled: false`；
- 当前会话在 `AGENTS.md` 被写入/修改后，收到了 DSH 的 `workspace instructions` 注入
  （页面顶部以 `Instructions from: AGENTS.md` 提示，改内容会触发 "Updated instructions"）；
- 隔离实例 CDP 实测（遮罩方案）：切场景时 `#scene-veil` 的 opacity 时间线为
  `0 → 0.46(约100ms) → 0.99(186ms) → 1(321ms)`；旧场景（6 个面板）一直保留到 321ms 遮罩**全黑之后**
  才换成新场景（2 个面板），数据在遮罩内就位，462ms 后开始淡出；
- 模拟"加载页停留 10s"（重载时把 `__bootFinish` 延迟 10s）：全过程 `body.booting=true`、
  `#harness-webview` 的 `visibility=hidden`、场景在遮罩后完成落地，截图里只有加载页、没有闪帧；
- DSH webview 加载后 `className` 含 `ready` 且 `opacity=1`；渲染层 0 报错；
- DSH 引擎页淡入淡出实测（隔离实例）：切到引擎页前后 `did-start-loading` 事件计数为 **0**（不再整页重载）；
  切换后 240ms 截图里 DSH 内容被黑幕压暗约 70%，1500ms 完全显示；切回场景 150ms 截图接近全黑，
  450ms 看到场景遮罩，1250ms 回到正常总览；
- `node tests/e2e/workbench.mjs` 18 步仍全部通过（等待数据的时间已包含在遮罩窗口内）。

## 22. 第十八轮：设计器「点节点改下一步连接」修复（2026-11-23）

### 22.1 现象

- 「工作流设计」场景（`am-designer`）里点节点没有反应：既看不到参数，也改不了「下一步连到」；
  拖动节点松手还会弹回原位。

### 22.2 根因（四个叠在一起）

1. **松手整块重画**：`mousedown` 之后的 `mouseup` 里调用 `draw()`，卡片被 `innerHTML = ''` 换掉；
   浏览器随后派发的 `click` 找不到原节点 ⇒ 单击事件根本到不了卡片（只有真实鼠标能复现）。
2. **编辑器在滚动区最底下**：`.am-node-editor` 追加在 legend / foot 之后，而画布自身
   `min-height: 420px`；面板可视高度不足时编辑器落在折叠线以下 ⇒ 即使打开也看不见，
   表现就是「点了没反应」。
3. **改下拉就重画**：连接下拉的 `change` 里调用 `draw()`，编辑器与下拉一起被清掉，
   只能改一次、也看不到改完的结果。
4. **拖拽位置不持久**：拖动只改临时 `p`，`mouseup` 的 `draw()` 又按自动布局重排 ⇒ 松手弹回。

### 22.3 修法

- `mouseup` 只在「真的移动过（≥4px）」时更新连线，否则打开右侧编辑器；不再整块 `draw()`。
- 画布与编辑器改成 `.am-designer-main` 两栏（画布 flex，编辑器固定 300px、常驻右侧）；
  发布对话框也放右侧，避免再沉到面板底部。
- 改连接只 `relayout()` + `paintCard()`（重算位置、重画连线、更新卡片摘要），编辑器保持打开。
- 拖动写入 `state_.pos`，`layout()` 优先使用手动摆位；新增「自动排布」清空手动摆位。
- 节点卡片底部增加连线摘要（`→ target` / `是→ … 否→ …` / `未连下一步`），不点开也能看到连接；
  纵向层距 92 → 124px，避免摘要换行后上下层卡片重叠（实测最高卡片 107px）。
- 删除节点时清掉指向它的 `next / on_true / on_false`；改节点类型时清掉旧类型专属字段与分支连线。

### 22.4 验证

- 回归新增第 14 步「设计器：点节点能改『下一步连到』」，用**真实鼠标**点第一张卡：
  编辑器出现 → 把 `start.next` 由 `region_stats` 改成 `segment` → 下拉值保持、
  卡片摘要变「→ segment」、标记「未发布」、编辑器未被重画；
- 同一轮隔离实例实测：拖动后位置变化且不弹编辑器；「自动排布」后 8 个节点 0 重叠；
  页面 0 报错；
- `node tests/e2e/workbench.mjs` **19/19** 通过（隔离外壳副本 `WB_SHELL_DIR`，含原有 18 步）。

### 22.5 使用

打开「工作流设计」→ 点任意节点 → 右侧改「下一步连到 / 条件成立时 / 条件不成立时」；
改完立即生效并标记「未发布」，点「发布新版本」才落库。拖动节点可摆位，点「自动排布」恢复分层。

## 23. 第十九轮：启动永远卡在 92% 的根因与修法（2026-11-23）

### 23.1 现象

用户反馈：**每次**打开工作台都停在「DSH 引擎 / 引擎已就绪，正在加载界面… 92%」，
明细里写着「内置入口 · 6.8s」「平台已就绪 · 接口 8000 / 站点 5173」，只有手动点「立即进入」才能进。

关键判据：92% 是 `main.js` 在**引擎端口刚能连**时发的 `sendBoot({stage:'ready', pct:92})`；
渲染层真正开始加载时会把它推到 94%（`loadHarness` 里的 `__bootPaint({stage:'ui', pct:94})`）。
**停在 92% 就说明 `loadHarness()` 根本没走到"设置 src"那一步。**

### 23.2 根因（两个缺陷叠在一起）

1. **"就绪"比 token 早**（真因）。`probe()` 只要 `GET /` 有响应就返回 true，
   而 dsh 是**先 listen 成功、再在 stdout 横幅里打印 `http://127.0.0.1:3083/?token=…`**。
   `server.log` 实证（2026-11-23 22:44 那次）：
   ```
   engine ready in 6.8s via 内置入口
   [boot] 引擎就绪总耗时 7.0s
   [token] captured: pf_k31-…        ← token 比"就绪"晚到
   ```
   而 `harness:ready` ⇄ `isHarnessReady()` 的判据是 `engineIsForeign || !!harnessToken`。
   token 还没到手 ⇒ 渲染层 `loadHarness()` 里 `if (!ready) { …; return; }` 直接放弃；
   而"12 秒兜底收起加载页"的 `watchHarnessReady()` **只在设置 src 之后才挂上** ⇒ 永远不会触发。
   结果：进度条停在 92%，没有任何东西会再来推进它（webview 也从未被加载）。
2. **兜底从来没生效**。`retarget.js` 的 `autoEnterWhenStuck()` 按"页面文字里有没有'加载中'"判断，
   且**一次判否就 `clearInterval`**。启动前 7 秒的文案是「检查引擎状态… / 正在启动 Harness 引擎…」，
   2 秒后的第一跳就判成"没卡住"并退出 ⇒ 「立即进入」永远不会被自动点（§17.2 的修法实际是空转）。

### 23.3 修法（四层，各管一段，都不改交互）

| 层 | 位置 | 改法 |
|---|---|---|
| ① 源头 | `main.js` `waitForToken(4000)` | 端口通了之后**再等 token**（100ms 轮询，最多 4s），才发 92% 与"就绪" |
| ② 总出口 | `main.js` `signalHarnessReady()` | `harness:ready` 只从这一处广播；`captureToken()` 里若发现"宣布就绪时 token 还没打印"，**补发一次** |
| ③ 渲染层闸门 | `renderer.js` `loadHarness` / `armHarnessReadyRetry` | 未就绪不再躺平：500ms×40 重试；25s 硬兜底——就绪就直接收起，**没就绪则如实报错 + 显示「重试启动」，绝不进没有 token 的白页**；另加"进过没 token 的地址"自愈一次（先探 guest 是否已渲染 UI，一生只做一次，避免切页重载） |
| ④ 最后兜底 | `retarget.js` `autoEnterWhenStuck` | 判据改成**加载页本身在不在**（`#boot-overlay` 没有 `hide`），与阶段文案无关；且只在 `isHarnessReady()` 为真时才点「立即进入」 |

### 23.4 验证（隔离实例实测，不动正在跑的工作台）

做法：把 `外壳` 复制到 `%TEMP%\amtest-fix\外壳`（`node_modules` 与 `引擎` 用 junction 指回仓库），
`DSH_PORT=3091`、`DSH_CUSTOMER_HOME` 指向 `.dsh` 的独立副本 ⇒ 自带单实例锁与数据目录，与在跑的实例互不影响；
用 `--remote-debugging-port=9244` + CDP 采样加载页状态。

| 检查 | 结果 |
|---|---|
| 日志顺序（修后） | `[token] captured: XFr_…` → `dsh web: …?token=…` → `engine ready in 16.1s`（修前 token 在 `engine ready` 之后） |
| 进度条时间线 | +16.1s paint **94%「界面渲染中…」**（说明真的走到了 `loadHarness` 设置 src）→ webview `src` 带 token → 16.7s **100%「已就绪」**、`body.booting` 移除、遮罩收起 |
| 落地 | 自动落到「工作台总览」；guest 渲染出侧栏与会话列表（`[data-side="sidebar"]`、`root.children=1`）；页面 0 报错 |
| 慢启动场景 | 双引擎抢 CPU 时引擎用了 16.1s：兜底**没有抢跑**（不再点进无 token 的地址），token 到位后才进 |
| 回归 | `node tests/e2e/workbench.mjs`（`WB_SHELL_DIR` 指向隔离副本）19/19 |

### 23.5 已知边界

- 若某天 dsh 改了横幅格式、`waitForToken(4000)` 等不到 token：界面会显示
  「引擎还没起来，界面暂时进不去 / 可点「重试启动」」——**不会白屏、也不会假装就绪**；
  此时改 `main.js` `captureToken()` 的正则即可。
- 启动慢（引擎真在起，>14s）时不再是"卡住"：进度条会继续爬（14%→88%），到预算（45s/90s）仍起不来才报错。

## 24. 每个场景一个「DSH 会话」面板（2026-11-24）

**动机**：场景记忆（`agentmatrix-workbench/说明/记忆约定.md`）按场景分文件夹，但此前只有总览有真会话；
其余场景的「场景助手」是 `POST /workbench/ask` 的原生面板，读不到、也写不进本场景的 DSH 会话。

**改动**

| # | 文件 | 改法 |
|---|---|---|
| 1 | `外壳/scenarios/{designer,matrix,delivery,governance}.json` | 各加一个 `harness` 面板：`ds-chat` / `mx-chat` / `dl-chat` / `gv-chat`（21 → **25** 面板 = 20 原生 + 5 harness） |
| 2 | `外壳/renderer/renderers.js` `panelPartition()` | **一板一分区**：`persist:harness-panel-<面板id>`，不再要求 json 写 `sessionId`（主窗口共用 `persist:harness` 会让 5 个面板互抢 `dsh.sessions.current`） |
| 3 | `外壳/scenarios/overview.json` | 去掉 `ov-chat` 的 `sessionTitle` / `pinTarget`：引擎里**没有**「工作台总览」这条会话，按标题钉本来就不成立 |
| 4 | `外壳/scripts/sessions.mjs --check` | 只有**按标题/候选名钉会话**的面板才强制 `sessionId`；纯分区记忆的面板记「○ 未绑定」 |
| 5 | `工具/场景记忆.mjs check` | 无 `sessionId` 的 harness 面板记 ok「按分区记忆」，不再报「会话未绑定」 |
| 6 | `tests/e2e/workbench.mjs` | 五个场景的 `expect` 都加「DSH 会话」；断言仍是每个 harness 面板恰有 1 个 webview |

**验证状态（2026-11-24）**：代码 / 场景 JSON / 文档已改；`场景记忆.mjs check --all` 5/5 通过、
`sessions.mjs --check` 5 个面板全「○ 未绑定」通过；**界面未在真实实例验证**——改动要重启工作台才生效，
而重启会中断正在跑的会话。重启后需补：五个场景各 1 个 webview、各记各的会话、`node tests/e2e/workbench.mjs` 通过。

**回退**：`git checkout -- 外壳/renderer/renderers.js 外壳/scenarios` 即回到 21 面板单会话形态。

> 后续（2026-11-24 晚，§26）：本节留下的"五个面板未绑定会话、界面未验证"已处理——每个场景绑定自己的
> `场景 · <场景名>` 专属会话，场景内改成单会话模式（不显示全局侧栏）；本节其余内容保留为历史记录。

## 25. 第二十一轮：删除四个场景的「场景助手」面板（2026-11-24）

**动机**：第二十轮给每个场景加了真「DSH 会话」面板后，同一屏出现两个 AI 入口——
「DSH 会话」（真会话，读写本场景记忆）和「场景助手」（`POST /workbench/ask`，一次性问答）。
使用反馈认为后者冗余：**同一块屏不需要两个 AI 窗口**。

**改动**

| # | 文件 | 改法 |
|---|---|---|
| 1 | `外壳/scenarios/{overview,designer,matrix,governance}.json` | 删 `ov-ai` / `ds-ai` / `mx-ai` / `gv-ai`，重排到无空洞：总览 4 行（DSH 会话 3×2 移到 `c2r3`）、设计器整宽 4×4、能力矩阵智能体/技能库各 2×2、治理 DSH 会话 3×2 + 账号 1×2。**25 → 21 面板 = 16 原生 + 5 harness** |
| 2 | `scripts/layout-full.cjs` | 改成当前基线脚本（含 harness、无 assistant），自带「4 列越界 / 重叠」校验 |
| 3 | `scripts/layout-native.cjs` | 顶部标注为历史快照，禁止直接运行（否则会把旧版式写回） |
| 4 | `外壳-test/`（隔离回归副本） | 同步 `scenarios/*.json` 与 `renderer/renderers.js`（副本此前落后一版 `panelPartition`） |
| 5 | `tests/e2e/workbench.mjs` | 五个场景 `expect` 去掉「场景助手」；每个场景断言**没有** `am-assistant`、**恰好 1 个** `harness`；原「场景助手真的回答（真实模型）」一步改成「5 个场景都没有场景助手、各恰好 1 个 DSH 会话」 |
| 6 | `scenarios/_场景身份索引.md` | 20 行 → 16 行，仍是 7 列；跑 `stamp` 重盖 5 个场景的身份卡 |

**保留（有意不删）**：`am-assistant` 渲染器、`/workbench/ask` 接口、审计动作「场景助手提问」。
要恢复只需在场景 json 里写回面板配置，不需要改代码。

**验证（2026-11-24，隔离副本）**

- `node tests/e2e/workbench.mjs`（`WB_SHELL_DIR=agentmatrix-workbench\外壳-test`）：**19/19 通过**，
  含「5 个场景：场景助手 0 个，DSH 会话各 1 个」；刷新当前场景后仍是 6 个面板（治理）、注册表 18 个原生类型不变；
- 截图 `tests/e2e/artifacts/workbench-native.png`：治理场景 6 个面板铺满 4×6 网格，无空洞、无重叠；
- 五个场景坐标做过程序化校验（4 列内、互不重叠、每格都有面板）；
- `node 工具\场景记忆.mjs check --all`：5/5 通过（stamp 后卡指纹一致）。

**回退**：`git checkout -- 外壳/scenarios 外壳-test/scenarios tests/e2e/workbench.mjs`，再把 `am-assistant` 面板写回 json
（渲染器与接口一直都在）。



## 26. 第二十二轮：场景专属单会话 + 侧栏显示修复（2026-11-24 晚）

### 26.1 现象

- 五个场景的「DSH 会话」面板都显示**同一条/随机的旧会话**（例如总览里出现"删除场景助手窗口建议"），
  切场景时会串会话；面板标题行显示「未切到 · DeepSeek Harness」。
- 面板里的**侧栏打不开**；侧栏按钮要么不在左边、要么出现在右上角；窄面板里干脆没有侧栏入口。
- 用户要求：**每个场景只能看到本场景的 DSH 会话**；跨场景的共同修改由标签栏最前面的「DSH 引擎」主会话协调。

### 26.2 根因（两条叠在一起）

1. **会话没有绑定**：§24 把五个面板改成"一板一分区 + json 不写 sessionId"，面板只记住自己分区里
   `dsh.sessions.current` 的**上一次值**；第一次打开时它可能指向任意一条旧会话（甚至是别的场景的）。
   所以"一板一分区"只解决了"互抢"，没有解决"该显示哪一条"。
2. **精简注入的 DOM 选择器过期**：引擎 0.2.2-rc.5 把会话头包进 `[data-slot="conversation.header"]`
   （`display:contents`），旧规则 `[data-phase] > header` 打不中 ⇒ 右上角「打开右侧边栏」一直露着；
   `[data-side="sidebar"]` 在 0.2.2 里是**拖宽手柄**，不是侧栏列 ⇒ 只藏它不会藏侧栏；
   强制三轨道 `0 / 1fr / 0` 又把左侧栏压成 0 宽，侧栏开关被裁掉，所以"打不开、按钮跑到右边"。

### 26.3 做法

| # | 文件 | 改法 |
|---|---|---|
| 1 | `外壳/scenarios/*.json` | 五个 harness 面板各写 `sessionTitle` / `sessionId` / `pinTarget`，绑定本场景专属会话（标题：`场景 · 工作台总览` / `场景 · 工作流设计` / `场景 · 能力矩阵` / `场景 · 交付追踪` / `场景 · 治理与策略`）；面板 `sub` 改为「本场景专属会话 · 不会显示其他场景的会话」 |
| 2 | `外壳/renderer/renderers.js` + `外壳/main.js` | 两份 `HARNESS_CHAT_CSS` / `HARNESS_FIX_JS` 同步改成**单会话模式**：三轨道保留、左右列 `[class*="sidebarCol"]` / `[class*="rightbarCol"]` 直接 `display:none`；藏 `[data-shell-leading]`、`[data-sidebar-toggle/opener/mask]`、右栏按钮（按 aria-label）、拖条；**保留会话头**（标题 / 标准模式 / 对话·轨迹 页签），只藏右栏按钮。渲染层不再调用主进程 `harness:wv:inject`（避免旧常量覆盖新规则），主进程那份保留为历史兜底 |
| 3 | `renderers.js` `HARNESS_PIN_JS` | 首次绑定自动 reload **一次**（键 `app_pin_autoloaded_<sessionId>`）：从旧会话/欢迎页切到目标会话；每个目标只自动刷一次，避免回到"每 3 秒自动刷新"的老问题；id 失效时仍退回手动提示 |
| 4 | `工具/场景会话.mjs`（新增） | `list` / `ensure [--seed]` / `check`：引擎里按标题找；缺了就 `session/create` + `rename`，可选写一条"本场景常驻会话"开场消息，并把 id 回写场景 json 与 `_场景身份索引.md` 第一行；换机器/清空 `.dsh` 后一键重建 |
| 5 | `外壳/scenarios/_场景身份索引.md` | 「会话 / 会话 id」两列填上五条专属会话；说明改为"场景内单会话、全局列表只在 DSH 引擎页" |

**会话分工**：场景面板 = 本场景专属会话（单条、无侧栏，不能切到别的场景）；「DSH 引擎」页 = 不注入的完整界面，
保留全局会话列表与所有侧栏能力，作为跨场景共同修改的协调入口。五个专属会话的开场消息已写明：
"涉及跨场景的共同修改时，提示用户到「DSH 引擎」主会话统一协调"。

### 26.4 验证（2026-11-24 晚，隔离副本 + 真实引擎）

- `node 工具\场景会话.mjs check`：**5/5** 通过（标题与 id 均命中）；
- Playwright 直接打开 5 条专属会话：标题、会话头、输入框都在，侧栏 `display:none`；
- 隔离工作台（`WB_SHELL_DIR=agentmatrix-workbench\外壳-test`，CDP）逐场景实测：
  5 个场景分别落在 `场景 · 工作台总览 / 工作流设计 / 能力矩阵 / 交付追踪 / 治理与策略`，
  `sidebarCol display=none`、`[data-sidebar-toggle]` / `[data-sidebar-opener]` / 「打开右侧边栏」宽高均为 0，
  输入框存在；截图 `tests/e2e/artifacts/wb-{overview,designer,matrix,delivery,governance}.png`；
- `node tests/e2e/workbench.mjs`（隔离副本）：**19/19 通过**。

### 26.5 边界与回退

- 场景 json 里的 `sessionId` 是**本机引擎**的 id；换机器 / 清空 `引擎/.dsh` 后先跑
  `node 工具\场景会话.mjs ensure --seed`，再重启工作台（首次需跑一次，之后 id 稳定）。
- 场景内不显示侧栏 ⇒ 场景面板里没有文件/终端/插件侧栏；这些能力仍在「DSH 引擎」页。
- 回退：`git checkout -- 外壳/renderer/renderers.js 外壳/main.js 外壳/scenarios docs/workbench-template.md`
  并删除 `工具/场景会话.mjs`；会话本身不删（数据零删除）。

