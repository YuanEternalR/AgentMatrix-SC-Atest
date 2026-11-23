# 项目交接（新会话从这里开始）

> 旧会话过长会导致模型传输超时。新开对话时把这份文档丢给助手，它就能立刻接上。
> 最后更新：2026-11-23

## 0. 最高准则：中文只出现在「用户看得见的地方」

- **界面文案、提示、错误说明、文档、提交说明** → 中文，让所有用户都看懂；
- **代码标识符、文件名、日志字段、脚本内容** → 英文 / ASCII，按各语言惯例来，不硬套中文；
- **绝不为了"用中文"去折腾文件编码**：BOM / GBK / UTF-16 反复转换已经几次把功能搞坏
  （场景 JSON 带 BOM 被静默跳过、`.cmd` 里的中文被当成命令、`.vbs` 里的中文把语句拆坏）。
  编码规则定死：

  | 文件类型 | 编码 |
  |---|---|
  | `.py` `.ts` `.tsx` `.js` `.mjs` `.css` `.md` `.json` | UTF-8 **无 BOM**（JSON 绝不能带 BOM） |
  | `.ps1` | UTF-8 **带 BOM**（PowerShell 的硬规定） |
  | `.cmd` `.bat` `.vbs` | **纯 ASCII**，中文一律不写进去；要中文提示就转到 Node/PS 里输出 |

- 判断标准只有一条：**用户看到的是不是一堆英文**。是 → 改成中文；不是 → 别动。
- 反面教材（本会话真实踩过）：为了让 `.cmd` 能显示中文提示而写中文，结果 cmd 按 GBK
  解析 UTF-8 字节，整份脚本被拆成乱码"命令"，程序根本打不开。图省事反而更慢。

## 一句话现状

面向供应链的智能体矩阵工作台：**真实数据 + 真实模型 + 真实调度 + 可追溯审计**，
四条业务链路全部跑通，界面全中文，技能与智能体可在界面里建/测/发版，图表可导出，
可通过 DSH 插件用自然语言驱动工作台。

## 怎么启动

```bat
cd D:\Document\毕业设计\agentmatrix-sc
dev up          :: 启动 5 个容器（WSL 闲置会回收，任何异常先跑这个）
dev ps          :: 5 个都必须是 healthy，health: starting 说明还在起
dev health      :: 期望 {"status":"ok"}
```

- 前端 http://127.0.0.1:5173 ｜ 接口 http://127.0.0.1:8000/docs
- 账号：`admin / dev / ops / viewer @agentmatrix.local`，密码 `AgentMatrix@2026`
- 模型：`.env` 里 `LLM_PROVIDER=deepseek`（真实调用）；切 `mock` 可完全离线

## 技术栈与结构

```
apps/api      FastAPI + SQLAlchemy 2.0 + PostgreSQL 16（Alembic 迁移，19 张业务表）
apps/web      Vite + React 18 + TypeScript + ECharts
infra         docker compose（api / worker / web / postgres / redis）
scripts       导入、压测、取证、自检脚本
dsh-plugins   DSH（Cordis）插件：把工作台能力暴露成 4 个工具
docs          架构、接口、调度策略、实验、演示、审计
```

## 当前规模（都已验证）

| 项 | 数量 | 说明 |
|---|---|---|
| 业务链路 | **4 条** | 订单延迟闭环 / 区域履约诊断 / 周度补货建议 / 承运商风险巡检 |
| 智能体 | **15 个种子 + 可自建** | 覆盖 8 个阶段；界面可新建、绑定技能、在线测试、发版 |
| 技能 | **15 个种子 + 可自建** | 内置函数 + HTTP（默认 Mock，可切真实并受 SSRF 约束） |
| 矩阵 | **8 阶段 × 4 能力 = 32 格** | 覆盖 26 格（81.3%），6 个缺口 |
| 接口 | 52 个（60 个操作） | `/docs` 可查（含 `/workbench/*`） |
| 审计动作 | **18 类** | 登录/失败、建任务、发布、审批、死信、告警、技能增改删、智能体增改发版 |
| 订单数据 | 65,752 单 | DataCo 真实数据集，SHA256 可追溯 |
| 单元测试 | 128 条 | 容器内 `pytest /tests/unit`；宿主机 102 条（ORM 用例自动跳过） |
| E2E | 17 步 | `node tests/e2e/e2e.mjs`（业务主线，含 Ctrl+K 搜索与确认弹窗） |
| 路由冒烟 | 18 个页面 | `node tests/e2e/routes.mjs`：逐页断言无运行时错误、主内容非空 |

## 四条业务链路

| 链路 | 链路形态 | 数据来源 |
|---|---|---|
| 订单延迟异常闭环 | 查单 → 影响评估 → 智能体分析 → 条件（影响分≥3）→ 审批 → 通知 | 真实订单表 |
| 区域履约诊断 | 区域指标 → 按运输方式拆解 → 智能体诊断 → 条件（延迟率≥50%）→ 审批 → 整改单 | 真实订单表 |
| 周度补货建议 | 需求预测 → 库存快照 → 补货量 → 条件 → **运营/管理员双人审批** → PO 草稿 | 真实销量；库存由调用方传入 |
| 承运商风险巡检 | 履约信号 → 风险评分 → 智能体诊断 → 条件（风险分≥60）→ 审批 → 处置单 | 真实订单表（运输方式作为承运商代理） |

## 常用命令

```powershell
python scripts/check_llm.py --plan                    # 验证模型 Key 与 S4 规划器
python scripts/record_runs.py                         # 跑一批真实任务并存证
powershell -File scripts\check-rbac.ps1               # 四角色权限（7 项）
powershell -File scripts\check-audit.ps1              # 审计留痕/脱敏/权限/只追加/导出（18 项）
powershell -File scripts\check-skills-agents.ps1      # 技能/智能体/SSRF/引用保护（32 项）
powershell -File scripts\reset-demo.ps1               # 重置演示数据（四条链路）
powershell -File scripts\smoke-test.ps1               # 订单链路冒烟
powershell -File scripts\smoke-test.ps1 -Workflow fulfillment_review
node tests/e2e/e2e.mjs                                # 端到端 17 步（业务主线）
node tests/e2e/routes.mjs                             # 路由冒烟 18 个页面（防白屏/崩溃）
node tests/e2e/workbench.mjs                          # 工作台原生面板 7 项（含"不许嵌网页"断言）
python -m pytest -q                                   # 单元测试（宿主机 102 条）
docker compose -f infra/docker-compose.yml exec -T api python -m pytest /tests/unit -q   # 容器内 128 条
```

## 关键约束（改代码前必读）

1. **界面不出现英文代码**：所有 code → 中文映射集中在 `apps/web/src/labels.ts`，
   E2E 有断言守着，泄露会挂测试。
2. **条件表达式不支持跨字段比较**：只支持「字段 比较 字面量」与 `in`。
   需要跨字段判断时，在技能里算成布尔值传出来（`calc.need_replenish == true`）。
3. **DSH 插件 schema 三条规矩**（见 `docs/dsh-integration.md`）：`parameters` 必须是
   标准 JSON Schema；属性名不得与 JSON Schema 关键字同名；object 必须写 `additionalProperties`。
4. **脚本编码有讲究**：PowerShell 脚本必须带 **UTF-8 BOM**（否则中文被当 ANSI 解析失败）；
   `.cmd` / `.bat` 反过来——**必须纯 ASCII**（cmd.exe 按 GBK 码页逐行解析，
   UTF-8 中文会被拆成乱码"命令"，报一串 `'xxx' 不是内部或外部命令`）。
   中文逻辑放到 Node（`node scripts/xxx.mjs`）或 PS1 里，`.cmd` 只做转调。
   `agentmatrix-workbench/start.cmd` 就是这么踩过一次坑后改的。
5. **前端改完要 `docker compose restart web`**（`/mnt/d` 上 inotify 不可靠）。
6. **审批节点会校验角色**：`assignee_role` 必须匹配（admin 可代批），同一次运行的
   多个审批需不同人。自动审批脚本要按角色准备 token。
7. **数据与实验数字必须可复现**：脚本 + SHA256 清单，不手填。
8. **`audit_logs` 只能追加**：不要加 update/delete 代码，`reset-demo.ps1` 的 TRUNCATE
   也不含它；数据库触发器会直接拒绝。新增需要留痕的操作时，在路由里调
   `services/audit.record()`，与业务同事务提交。
9. **技能默认走 Mock**：`config.mock` 默认 true，离线演示不联网。要打真实地址必须
   显式关掉，且域名要进 `allowed_hosts`（否则 SSRF 防护会拒回环/内网/元数据地址）。
   建技能与试运行都受这条约束，`scripts/check-skills-agents.ps1` 里有断言。
10. **技能/智能体的变更走版本接口**：改配置是 `POST /skills/{code}/versions`、
    改提示词是 `POST /agents/{code}/versions`，不要直接 UPDATE 表——版本不可变
    是论文里的论点之一，绕过去就自相矛盾了。
11. **调度策略改库、不改环境变量**：`/settings/dispatch` 写 `system_settings`，
    `dispatcher.make_strategy(db)` 与 Worker 每轮都读它；`.env` 里的 `DISPATCH_STRATEGY`
    只是"没在界面改过时的默认值"。改完不要重启服务（本来就不需要）。
12. **交互约定（2026-11-23 统一）**：操作反馈用 `toast.success/error`（`components/Toast.tsx`），
    **不要**再往页面顶上塞 `.alert` 占位——那会顶动整页。加载失败仍用页内 `.alert`。
    危险操作用 `await confirmDialog({...})`（`components/Confirm.tsx`），不要用 `window.confirm`。
    列表加载用 `<TableSkeleton />` / `<CardSkeleton />`，判断条件要区分"没加载完"与"确实没数据"。
13. **新页面/改页面后必须跑 `node tests/e2e/routes.mjs`**：业务 E2E 只覆盖主线，
    不会打开每个页面。2026-11-23 调度策略页就因为一个 `useMemo` 写在提前 `return` 之后
    （数据到达后 hook 数量变多）整页白屏，而当时 17 步 E2E 全绿——路由冒烟就是补这个洞的。
    **React 规则：所有 hook 必须在任何提前 return 之前。**
14. **工作台（`agentmatrix-workbench/`）是"模板 + 换领域"**：整份复制
    [`luanyujia-workbench`](../../luanyujia-workbench-main/) 的公开模板（MIT），
    只改领域，不重写壳。约定：
    - 场景在 `外壳/scenarios/*.json`（文件名必须等于 `id`），记忆在 `引擎数据/.dsh/场景记忆/`；
    - 加场景 = 丢一份 JSON + 在 `_场景身份索引.md` 登记，不用改代码；
    - **不自己起引擎**：`工作台配置.ini` 的 `DSH_PORT` 指向正在运行的 DSH（默认 58360），
      `main.js` 探测到端口在监听就复用（日志 `reuse: port already listening`）；
    - AI 面板**不用模板的 harness**（要引擎目录 + 引擎 token，本机都没有），改用我们自己的
      `/assistant` 页嵌进面板，回答来自 `POST /workbench/ask`（真实模型 + 实时快照）。
15. **面板必须是原生渲染器，不许嵌网页**（用户明确要求"面板独自完成功能"）：
    面板写在 `外壳/renderer/am-panels.js`，注册成 `APP_RENDERERS['am-xxx']`；
    数据走 `window.am.get/post`（main.js 代理我们的 API，token 不进渲染层）；
    样式只用模板变量（`--bg-panel` / `--border` / `--text-dim` / `--accent`）。
    现有 18 个：kpi/tasks/approvals/assistant/matrix/agents/skills/runs/chart/deadletters/designer/create/
    dispatch/audit/workflows/alerts（+ assistant 复用）。数据通道默认用开发者账号
    （`dev@agentmatrix.local`），因为调度保存与工作流校验只接受 developer。
    已知易错点：模板「刷新当前场景」会换掉 `APP_RENDERERS` 对象（我们用 `__amPanels` + 访问器守护）；
    矩阵接口的字段是 `stages[].code` / `categories[].code`（不是 stage/category）；
    下拉必须每次重绘重建；原生 `option` 要显式上色；抽屉收起只能隐藏、不能清空容器；
    SVG 的 `viewBox` 必须等于画布像素（否则坐标会被缩放），连线要在下一帧量。
    启动落地场景由 `renderer/customer-start.js` 的 `FIRST` 决定（现为 overview）。
    `node tests/e2e/workbench.mjs`（18 步）会断言面板内 **webview/iframe 数量为 0**、
    刷新后注册表不丢；谁把面板换成 `embed`、或把上面这些点改回去，测试立刻红。
16. **别在 `.cmd` / `.vbs` 里写中文**（见第 0 条）：`start.cmd` 纯 ASCII，只转调
    `scripts/launch.cjs`；`启动.vbs` 已删（UTF-8 中文会把 VBS 语句拆坏）。

## 已知边界（如实说明，不要当成 bug）

- `inventory_query`、`supplier_score` 仍是占位实现（公开数据没有库存/供应商主数据）；
  补货链路的库存**由调用方传入**，未传时按 0 并标注 `inventory_source=not_provided`
- **Cron 定时触发未实现**：演示用工作台或 API 触发
- **SQL / MCP 类型技能未实现**：创建接口直接 422 并说明；当前支持内置函数与 HTTP
- **在线测试是单轮**：一次技能收集 + 一次模型结论，没有多轮工具循环（引擎同样单轮）
- **设置页只做了「调度策略与权重」**：用户/模型供应商/密钥/队列并发/Webhook/数据保留未做
- **审计不覆盖"改派"与"密钥操作"**：系统没有改派接口、也没做密钥管理，无对应动作可记
- 调度策略对比实验是**离线仿真**（`docs/experiments/dispatch-comparison.md`），
  产品执行是真实模型，两者口径不同，论文里要分别标注
- 生产协同 / 售后逆向两行**没有产业系数**（投入产出表拆不出对应部门，刻意留空）
- 论文正文与 PPT 未开始

## 已完成的关键验证

| 验证 | 结果 |
|---|---|
| 真实模型调用 | 单步 0.4–1.2 s，token/成本真实计量 |
| 8 条真实运行取证 | `docs/experiments/real-runs/`，$0.0056 跑完 8 条 |
| 四角色权限 | `check-rbac.ps1` 7/7（只读禁改、运营禁发布、审批角色校验） |
| 审计日志 | `check-audit.ps1` 18/18（留痕、脱敏、403、CSV BOM、数据库拒删） |
| 技能 / 智能体 | `check-skills-agents.ps1` 32/32（HTTP Mock 试运行、故障注入分类、工具轨迹、发版、引用保护、SSRF） |
| 需求符合度审计 | `docs/requirements-audit.md`（12 ✅ / 5 🟡 / 0 ❌ 于验收清单） |
| 图表导出 | E2E 真实下载 CSV/PNG 并校验字节数 |
| DSH 插件调用 | 会话里一句自然语言 → 返回真实覆盖率，后端日志可追溯 |

## 下一步可选

1. **论文正文**：架构（第四章）、实验（第五章）素材已齐；`docs/design-guide.md` 可直接改写成"平台使用与设计"一节
2. **演示彩排**：按 `docs/demo-script.md` 过一遍并截图（新增 设计指南 / 技能库 / 智能体 / 调度策略 四页要补进脚本）
3. **UI 交互第二批**（第一批已完成：Toast、确认弹窗、骨架屏、Ctrl+K）：表格行内编辑、详情侧滑抽屉、暗色模式
4. **Cron 定时触发**：`schedules` 表 + Worker 每分钟检查
5. **设置页剩余部分**：用户/密钥/队列并发/Webhook

## 文档索引

| 文档 | 内容 |
|---|---|
| `docs/requirements-audit.md` | **对照原始需求的符合度审计（先看这个）** |
| `docs/design-guide.md` | **技能/能力/智能体/策略怎么设计与注册（新手先看这个）** |
| `docs/workbench-template.md` | **工作台外壳：从单页应用到场景工作室的架构移植记录** |
| `docs/report/` | 进度总结报告 DOCX（`build_progress_report.py` 生成，数字改动后重跑即可） |
| `docs/architecture.md` | 五层架构、数据模型、接口清单、技术选型偏差 |
| `docs/api.md` | 接口约定与示例 |
| `docs/dispatch-strategy.md` | 五种策略、实验设计、有效性威胁 |
| `docs/industry-chain.md` + `docs/experiments/matrix-stage-basis.md` | 产业链关联度与矩阵行的依据 |
| `docs/data-sources.md` | 真实数据来源、字段映射、不可得项 |
| `docs/dsh-integration.md` | DSH 插件实现、踩坑记录、验证证据 |
| `docs/demo-script.md` | 十条演示链路与答辩追问预案 |
| `docs/experiments/real-runs/` | 真实模型运行记录 |
