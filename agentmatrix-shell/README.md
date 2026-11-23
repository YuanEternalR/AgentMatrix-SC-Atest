# AgentMatrix-SC 工作台外壳

> 学自 [`luanyujia-workbench`](../luanyujia-workbench-main/)（DSH 多场景桌面工作台），
> 保留它的**四套机制**，换成我们自己的业务：供应链智能体矩阵。

## 它在做什么

把"一个网页里点来点去"变成"**一间按场景分工的工作室**"：

- **顶栏一排场景标签**：工作台总览 / 能力矩阵 / 交付追踪 / 治理与策略，点一下换一块界面；
- **每个场景是一块网格**，里面放若干**面板**（嵌我们已有页面、KPI 快照、场景记忆、场景助手）；
- **每个场景有自己的记忆文件**，AI 助手回答前会读它——所以"切场景 = 切脑子"，不是切标签。

## 四套机制（与源工作台的对应）

| 源工作台 | 这里 | 落地位置 |
|---|---|---|
| 场景 = 一份 JSON | 同 | `scenarios/*.json`（文件名必须等于 `id`） |
| 面板类型注册表 | 同（5 种：`view` / `status` / `memory` / `chat` / `links`） | `renderer/app.js` 的 `PANEL_RENDERERS` |
| 记忆在文件不在会话 | 同（每场景一份 `§〇 交接`，≤4KB） | `memory/<场景id>.md` |
| 壳与引擎解耦 | 壳只通过 HTTP 认识 AgentMatrix 后端，不 require 它的代码 | `main.js` / `server.js` 里的 `apiGet/apiPost` |

**没有照搬的**：源工作台的"会话绑定三字段"（`sessionTitle`/`sessionId`/`pinTarget`）是把
内嵌的 DSH 会话钉到面板上。我们这里 AI 面板换成**后端 `/workbench/ask`**——
场景记忆 + 实时快照交给模型，结论可以直接回写记忆。少了一层"钉会话"，但拿到了更硬的东西：
**助手看到的数字全部来自数据库当前状态**，不是它自己编的。

## 两种运行模式

| 模式 | 命令 | 适用 |
|---|---|---|
| Electron | `start.cmd`（或 `npm start`） | 正式演示：独立窗口、无地址栏、顶栏可拖动 |
| 浏览器 | `start.cmd web`（或 `node server.js`） | 没装 Electron / 自动化测试；`http://127.0.0.1:4180` |

两种模式跑**同一份渲染层**，差别只在 `preload` 的 IPC 与 `server.js` 的 HTTP 之间（接口一一对应）。
自动化测试测浏览器模式即可覆盖渲染层；Electron 是否起窗由 `shell.log` 里的
`renderer ready tabs=… panels=…` 证明。

## 首次运行

```bat
cd agentmatrix-sc\agentmatrix-shell
start.cmd
```

脚本会做三件事：① 缺 Electron 运行时则下载（走国内镜像）；
② 检查后端 8000 / 前端 5173 是否在线；③ 起窗口。

手动等价步骤：

```bat
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
node node_modules\electron\install.js
npm start
```

> ⚠️ 若环境里残留 `ELECTRON_RUN_AS_NODE=1`，Electron 会被当成纯 Node 跑，
> 报 `Cannot read properties of undefined (reading 'whenReady')` 后直接退出。
> `start.cmd` 已经防御性清掉这个变量。

## 加一个场景

丢一份 `scenarios/<id>.json` 即被自动发现，不需要改任何代码：

```json
{
  "id": "delivery",
  "name": "交付追踪",
  "order": 3,
  "cols": 6,
  "panels": [
    { "id": "dl-runs", "title": "运行监控", "type": "view", "path": "/runs", "col": 1, "row": 1, "w": 3, "h": 3 },
    { "id": "dl-ai",   "title": "场景助手", "type": "chat", "col": 3, "row": 4, "w": 4, "h": 2 }
  ]
}
```

- `id` 必须等于文件名，否则加载器直接跳过（不报错，界面上就是"场景不存在"）；
- `order` 决定标签顺序；`cols` 是网格列数；
- 面板 `col/row/w/h` 从 1 开始；不写坐标则交给自动排版。

面板类型：

| type | 作用 | 关键字段 |
|---|---|---|
| `view` | 嵌 AgentMatrix 已有页面（iframe，自动带 `embed=1` 隐藏主站导航，并注入登录态） | `path` |
| `status` | 场景快照：待审批 / 24h 成功 / 矩阵覆盖 / 积压（每 15s 刷新） | — |
| `memory` | 场景记忆编辑器（文件读写，带 4KB 红线提示） | `memoryOf`（默认当前场景） |
| `chat` | 场景助手：记忆 + 实时快照 → 模型结论，可一键写回记忆 | — |
| `links` | 快捷入口（在系统浏览器打开主站页面） | `items[{title,path,sub}]` |

## 快捷键

- `Ctrl+1..9` 切场景
- `Ctrl+R` 重开当前场景（面板会重建，定时器/监听器统一撤掉）
- 标签可拖拽换序（顺序存 localStorage）

## 已知边界

- 面板 iframe 需要主站（5173）在跑；后端不在时 KPI 与助手会显示错误，不会白屏；
- 场景助手默认走真实模型（DeepSeek）；离线演示时后端 `LLM_PROVIDER=mock` 即可；
- 没有做"场景弹出成独立窗口"（源工作台有），单窗口够用；
- `shell.config.json` 里是演示账号，正式环境应改为环境变量注入。
