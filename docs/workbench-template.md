# 工作台：改用成熟模板 + 换领域（2026-11-23 第二次重做）

> 前两版是我自己写的壳（`agentmatrix-shell/`）。用户否掉了它，理由一句话：
> **"这只是一种外观的仿照而已"** —— 自己搭的壳只学到了皮，交互、密度、面板能力都要从头造。
> 于是改为：**直接拿一套成熟的工作台模板（MIT），把它的领域换成我们的**。
> 代码在 [`agentmatrix-workbench/`](../../agentmatrix-workbench/)。

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

## 3. 关键取舍：不自己起引擎，复用正在跑的 DSH

模板启动时有两步：先探测 `DSH_PORT`，**端口已在监听就直接复用**（`engineIsForeign = true`），
否则才去 spawn `引擎\apps\cli\lib\bin.js`。

本机没有可用的 `引擎\` 目录（DSH 是打包进 `app.asar` 的安装版，没有 `apps/cli`）。
所以我们的做法是：

```
工作台配置.ini 里把 DSH_PORT 指到正在运行的 DSH Web GUI（默认 58360）
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
:: 1) 平台
cd agentmatrix-sc
dev up
dev ps                 :: 五个容器全部 healthy

:: 2) 工作台
cd agentmatrix-workbench
start.cmd              :: 会复用 工作台配置.ini 里 DSH_PORT 指向的 DSH 实例

:: 3) 需要自动化/截图时
set AM_DEBUG_PORT=9222
start.cmd              :: 之后可用 CDP 连 127.0.0.1:9222
```

## 7. 已知边界

1. `harness` 面板在复用模式下显示「引擎还没就绪」（见 §3）；
2. 模板自带的 `pc-*` / `review-*` / `neuron` 等渲染器还在代码里（约 1MB），只是没有场景使用——
   留着是为了以后要用时能直接加场景，不删；
3. 模板顶栏还有"文件夹""工具""插件"等入口，属于模板能力，保留；
4. 我们自己的 `agentmatrix-shell/` 已删除（git 历史里可查），避免两套壳并存。
