# 项目交接（新会话从这里开始）

> 旧会话过长会导致模型传输超时。新开对话时把这份文档丢给助手，它就能立刻接上。
> 最后更新：2026-11-23

## 一句话现状

面向供应链的智能体矩阵工作台：**真实数据 + 真实模型 + 真实调度 + 可追溯审计**，
四条业务链路全部跑通，界面全中文，图表可导出，可通过 DSH 插件用自然语言驱动工作台。

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
apps/api      FastAPI + SQLAlchemy 2.0 + PostgreSQL 16（Alembic 迁移，17 张业务表）
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
| 智能体 | **15 个** | 覆盖 8 个阶段 |
| 技能 | **15 个** | 全部内置函数，读真实订单表 |
| 矩阵 | **8 阶段 × 4 能力 = 32 格** | 覆盖 26 格（81.3%），6 个缺口 |
| 接口 | 41 个 | `/docs` 可查 |
| 审计动作 | **12 类** | 登录/失败、建任务、发布、审批、死信重试/忽略、告警规则增改删、告警确认/恢复 |
| 订单数据 | 65,752 单 | DataCo 真实数据集，SHA256 可追溯 |
| 单元测试 | 87 条 | 容器内 `pytest /tests/unit` 87 条；宿主机 78 条（ORM 用例自动跳过） |
| E2E | 12 步 | `node tests/e2e/e2e.mjs` |

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
powershell -File scripts\reset-demo.ps1               # 重置演示数据（四条链路）
powershell -File scripts\smoke-test.ps1               # 订单链路冒烟
powershell -File scripts\smoke-test.ps1 -Workflow fulfillment_review
node tests/e2e/e2e.mjs                                # 端到端 12 步
python -m pytest -q                                   # 单元测试（宿主机 78 条）
docker compose -f infra/docker-compose.yml exec -T api python -m pytest /tests/unit -q   # 容器内 87 条
```

## 关键约束（改代码前必读）

1. **界面不出现英文代码**：所有 code → 中文映射集中在 `apps/web/src/labels.ts`，
   E2E 有断言守着，泄露会挂测试。
2. **条件表达式不支持跨字段比较**：只支持「字段 比较 字面量」与 `in`。
   需要跨字段判断时，在技能里算成布尔值传出来（`calc.need_replenish == true`）。
3. **DSH 插件 schema 三条规矩**（见 `docs/dsh-integration.md`）：`parameters` 必须是
   标准 JSON Schema；属性名不得与 JSON Schema 关键字同名；object 必须写 `additionalProperties`。
4. **PowerShell 脚本必须带 UTF-8 BOM**，否则中文被当 ANSI 解析失败。
   `edit` 工具改完 .ps1 记得补 BOM。
5. **前端改完要 `docker compose restart web`**（`/mnt/d` 上 inotify 不可靠）。
6. **审批节点会校验角色**：`assignee_role` 必须匹配（admin 可代批），同一次运行的
   多个审批需不同人。自动审批脚本要按角色准备 token。
7. **数据与实验数字必须可复现**：脚本 + SHA256 清单，不手填。
8. **`audit_logs` 只能追加**：不要加 update/delete 代码，`reset-demo.ps1` 的 TRUNCATE
   也不含它；数据库触发器会直接拒绝。新增需要留痕的操作时，在路由里调
   `services/audit.record()`，与业务同事务提交。

## 已知边界（如实说明，不要当成 bug）

- `inventory_query`、`supplier_score` 仍是占位实现（公开数据没有库存/供应商主数据）；
  补货链路的库存**由调用方传入**，未传时按 0 并标注 `inventory_source=not_provided`
- **Cron 定时触发未实现**：演示用工作台或 API 触发
- **技能管理 / 智能体管理界面未实现**：只能通过种子脚本创建
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
| 需求符合度审计 | `docs/requirements-audit.md`（10 ✅ / 5 🟡 / 2 ❌ 于验收清单） |
| 图表导出 | E2E 真实下载 CSV/PNG 并校验字节数 |
| DSH 插件调用 | 会话里一句自然语言 → 返回真实覆盖率，后端日志可追溯 |

## 下一步可选

1. **技能/智能体管理页**（验收第 4、5 条）：只读列表 + 在线测试最小版 —— 剩下两个 ❌ 都卡在这
2. **Cron 定时触发**：`schedules` 表 + Worker 每分钟检查
3. **论文正文**：架构（第四章）、实验（第五章）素材已齐
4. **演示彩排**：按 `docs/demo-script.md` 十条链路过一遍并截图

## 文档索引

| 文档 | 内容 |
|---|---|
| `docs/requirements-audit.md` | **对照原始需求的符合度审计（先看这个）** |
| `docs/architecture.md` | 五层架构、数据模型、接口清单、技术选型偏差 |
| `docs/api.md` | 接口约定与示例 |
| `docs/dispatch-strategy.md` | 五种策略、实验设计、有效性威胁 |
| `docs/industry-chain.md` + `docs/experiments/matrix-stage-basis.md` | 产业链关联度与矩阵行的依据 |
| `docs/data-sources.md` | 真实数据来源、字段映射、不可得项 |
| `docs/dsh-integration.md` | DSH 插件实现、踩坑记录、验证证据 |
| `docs/demo-script.md` | 十条演示链路与答辩追问预案 |
| `docs/experiments/real-runs/` | 真实模型运行记录 |
