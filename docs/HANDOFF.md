# 项目交接（新会话从这里开始）

> 用途：旧会话过长会导致模型传输超时，新开对话时把这份文档丢给助手，
> 它就能立刻知道系统现状，不用重新摸一遍。

## 一句话现状

面向供应链的智能体矩阵工作台：**真实数据 + 真实模型 + 真实调度**，已完整跑通，
界面全中文，可通过 DSH 插件用自然语言驱动。

## 怎么启动

```bat
cd D:\Document\毕业设计\agentmatrix-sc
dev up          :: 启动 5 个容器（WSL 闲置会回收，报错先跑这个）
dev ps          :: 5 个都必须是 healthy，health: starting 说明还在起
dev health      :: 期望 {"status":"ok"}
```

- 前端 http://127.0.0.1:5173
- 接口 http://127.0.0.1:8000/docs
- 账号：`admin / dev / ops / viewer @agentmatrix.local`，密码 `AgentMatrix@2026`

## 技术栈与结构

```
apps/api      FastAPI + SQLAlchemy 2.0 + PostgreSQL 16（Alembic 迁移）
apps/web      Vite + React 18 + TypeScript + ECharts
infra         docker compose（api / worker / web / postgres / redis）
scripts       导入、压测、取证、自检脚本
dsh-plugins   DSH（Cordis）插件：把工作台能力暴露成 4 个工具
docs          架构、接口、调度策略、实验、演示脚本
```

## 现在有什么（都已验证）

| 能力 | 状态 | 入口 |
|---|---|---|
| 订单延迟异常闭环 | ✅ 真实订单（DataCo 65,752 单） | 工作台 → 发起任务 |
| 区域履约诊断与整改 | ✅ 真实聚合 + 真模型诊断 | 工作台 → 发起任务 |
| 五种调度策略 | ✅ S0–S4，S4 由真模型规划 | `docs/dispatch-strategy.md` |
| 可解释调度 | ✅ 每次决策落库，含因子与淘汰原因 | 任务详情 |
| 审批卡点 | ✅ 影响分 ≥3 才进审批 | 运行详情 |
| 重试 / 死信 | ✅ 错误分类 + 指数退避 | 死信队列 |
| 告警 | ✅ 4 条规则，显示当前值 | 告警页 |
| 矩阵 | ✅ 6 阶段 × 4 能力 = 24 格，覆盖 75% | 智能体矩阵 |
| DSH 插件 | ✅ active，工具可被对话调用 | `docs/dsh-integration.md` |
| 真实模型 | ✅ deepseek，`LLM_PROVIDER=deepseek` | `scripts/check_llm.py` |

## 常用命令

```powershell
python scripts/check_llm.py --plan          # 验证 Key 与 S4 规划器
python scripts/record_runs.py               # 跑一批真实任务并存证
powershell -File scripts\reset-demo.ps1     # 重置演示数据（真实订单号）
powershell -File scripts\smoke-test.ps1 -Workflow fulfillment_review
node tests/e2e/e2e.mjs                      # 端到端
python -m pytest -q                         # 单元测试（60 条）
```

## 关键约束（改代码前必读）

1. **界面不出现英文代码**：所有 code → 中文映射集中在 `apps/web/src/labels.ts`；
   E2E 有断言守着，泄露会挂测试。
2. **DSH 插件 schema 三条规矩**（详见 `docs/dsh-integration.md`）：
   `parameters` 必须是标准 JSON Schema、属性名不得与 JSON Schema 关键字同名、
   object 必须写 `additionalProperties`。
3. **PowerShell 脚本必须带 UTF-8 BOM**，否则中文会被当成 ANSI 解析失败。
4. **前端改完要 `docker compose restart web`**（`/mnt/d` 上 inotify 不可靠）。
5. **数据/实验数字必须可复现**：脚本 + SHA256 清单，不手填。

## 已知边界（如实说明）

- `inventory_query`、`supplier_score` 仍是占位实现（公开数据没有库存/供应商维度）
- 调度策略对比实验是**离线仿真**（`docs/experiments/dispatch-comparison.md`），
  产品执行是真实模型，两者口径不同，论文里要写清楚
- 论文正文与 PPT 未开始

## 下一步可选

1. 用真实模型做一次策略对比（同批任务 S2 vs S4，比成本与质量）
2. 演示彩排：按 `docs/demo-script.md` 八条链路过一遍并截图
3. 论文正文：架构（第四章）、实验（第五章）素材已齐
