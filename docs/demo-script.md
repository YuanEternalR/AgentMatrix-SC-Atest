# 演示脚本

> 两条链路，各 3 分钟。全部离线可跑，不依赖任何外部 API Key。

## 准备

```bat
dev up
dev seed        :: 首次或数据被清空后执行，幂等
dev ps          :: 确认 5 个容器都是 healthy
```

浏览器打开 http://127.0.0.1:5173 ，登录 `ops@agentmatrix.local` / `AgentMatrix@2026`。

---

## 链路一：订单延迟异常闭环（供应链域）

**目标**：展示"规划 → 调度 → 执行 → 审批 → 完成"的最小闭环，以及可视化打分依据。

1. 工作台 → 快捷发起 → 选「订单延迟异常闭环」，优先级 `1`、复杂度 `5`、数量 `420` → 发起任务。
2. 自动跳转任务详情，讲解右侧三块：
   - **策略 / 规划者 / 总分**：当前 `s4_llm_planner`，由大模型规划器提出候选；
   - **执行智能体**：`express-triage`（快线大模型）——因为它要满足"高优先级 + 高复杂度"；
   - **因子条形图**：能力匹配 0.500、历史成功率 0.485 的贡献；
   - **被淘汰的候选**：4 个智能体因缺少 `order_query` / `impact_assess` 被硬过滤。
3. 点「查看运行」→ 时间线依次出现 `start → fetch_order → assess_impact → evaluate → gate`，停在 `approve_remedy`（待审批）。
4. 点右上「通过」→ 2 秒内补上 `notify → end`，状态变为成功，显示耗时与成本。
5. 回到工作台，KPI 的成功率随之更新。

**可讲的点**：`evaluate` 节点的执行者不是写死的，而是由调度决策解析（`resolved_by: dispatch:s4_llm_planner`）。

---

## 链路二：文献综述生成（科研域）

**目标**：证明矩阵与调度层不绑定单一业务域——这是回应"题目写科研自动化、系统做供应链"的关键证据。

1. 左侧「智能体矩阵」→ 展示 7 阶段 × 4 能力的覆盖率（当前 78.6%），指出 6 个能力缺口。
2. 回到工作台 → 发起 → 工作流选「文献检索与综述生成」，标题自动切换，填研究主题 → 发起。
3. 任务详情：派给 `literature-scout`（小模型），因为它具备 `literature_search` + `relevance_screen`。
4. 运行详情看时间线，重点讲成本差异：
   - `extract` 用**小模型** literature-scout，约 `$0.0002`；
   - `draft` 用**大模型** research-writer，约 `$0.002`。
   - 这就是"大模型做规划、小模型执行"的成本收益。
5. 审批通过 → `publish` 节点产出 `智能体调度策略-综述草稿.md`（含参考文献与正文）。
6. 在「产物」卡片点「下载」，浏览器直接落地 markdown 文件，打开可见完整报告。

---

## 链路三：监控仪表盘（管理者视角）

1. 左侧「仪表盘」→ 一屏看到：运行总数、成功率、**P95 执行耗时**、累计成本。
2. 重点解释两个耗时口径：
   - **执行耗时**（P50 41ms / P95 231ms）：引擎与技能的真实开销；
   - **端到端耗时**（P95 37s）：含人工审批等待。
   - 分开报的原因：审批慢不该被误读成引擎慢。这是答辩时容易被追问的点。
3. 运行趋势图（按小时堆叠）、智能体调用分布、按工作流统计、最近失败。

---

## 链路四：故障注入 → 重试 → 死信 → 人工恢复

**目标**：展示错误分类、指数退避重试、死信队列与人工接管——这是工程深度最集中的一段。

一条命令跑完整演练：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fault-test.ps1
```

手工演示（订单号里带标记即可触发故障注入）：

| 订单号 | 行为 | 观察点 |
|---|---|---|
| `SO-FLAKY-001` | `notify` 前两次失败，第三次自动成功 | 运行详情里 `notify` 出现 3 条记录，前两条红色 `TRANSIENT`、状态 retrying |
| `SO-DEAD-001` | `notify` 连续 3 次失败 → 进入死信 | 「死信队列」出现一条，错误分类 `TRANSIENT`、尝试次数 3 |

死信页点「重试」→ 运行回到失败节点重新执行（第 4 次尝试成功）→ 死信状态变为 `retried`。

**可讲的点**：

- 只对 `TRANSIENT / RATE_LIMIT / UPSTREAM / TIMEOUT` 重试；`VALIDATION / BUSINESS / PERMISSION` 直接失败，不浪费模型调用。
- 退避是指数 + ±20% 抖动，重试任务带 `next_attempt_at`，到点前 Worker 不会领取。
- 死信与失败状态在同一次事务提交，外部不会看到"已失败但没有死信"的中间态。

---

## 答辩时可能被追问的三个问题

| 问题 | 现场演示 |
|---|---|
| 「这条运行为什么分配给这个智能体？」 | 任务详情页的打分拆解 + 淘汰原因 |
| 「审批超时/驳回会怎样？」 | 运行详情点「驳回」→ 运行直接 failed，错误码 `APPROVAL_REJECTED`；任务状态同步为失败 |
| 「上游一直失败怎么办？」 | 订单号带 `DEAD` 触发故障注入 → 3 次重试后进死信 → 人工重试恢复 |
| 「关掉网络、不配 API Key 还能跑吗？」 | 所有技能与 LLM 都是 Mock，`LLM_PROVIDER=mock`，断网也能完成所有链路 |

---

## 策略对比（论文第五章素材）

```powershell
python scripts/evaluate_strategies.py --count-per-type 8
```

生成 `docs/experiments/dispatch-comparison.md`。切换线上策略：

```powershell
# 修改 .env 中 DISPATCH_STRATEGY 后
dev up
```

可选值：`s0_all_large` / `s1_fixed_rule` / `s2_weighted` / `s3_cost_aware` / `s4_llm_planner`。
