# 并发压测报告

> 目的：回答"到底能扛多少并发"，而不是在文档里写一句"支持 50 并发"。
> 所有数字来自本机实测（Windows 11 + WSL2 + Docker）。**测量时 LLM 为 Mock**，因此不含真实模型时延；接入 DeepSeek 后端到端 P95 会明显上升（实测单次调用 0.4–1.2 s，偶发超时触发重试）。

## 1. 方法

| 项 | 设定 |
|---|---|
| 客户端 | `scripts/load-test.mjs`（Node，并发创建 + 自动审批 + 500ms 采样） |
| 工作流 | `order_delay_exception`（8 节点，含 1 个人工审批） |
| 载荷 | 每个任务 8 个步骤，其中 2 个技能、1 个智能体、1 个条件、1 个审批 |
| 审批 | 由脚本自动批准**本批任务**的审批，避免人工等待污染吞吐 |
| 计时 | 端到端 = 运行开始到结束；执行耗时 = 各步骤耗时之和（不含审批等待） |
| 复现 | `node scripts/load-test.mjs --tasks 50 --label 1-worker` |

采样口径：每 500ms 拉取一次任务与运行状态，积压 = `pending + queued`。

## 2. 结果

| 场景 | 任务数 | 即时分配 | 总耗时 | 吞吐 | 端到端 P50 / P95 | 执行耗时 P50 / P95 | 积压峰值 |
|---|---|---|---|---|---|---|---|
| 1 Worker | 50 | 50 | 6.9s | **7.22 /秒** | 0.60s / 1.47s | 0.342s / 0.760s | 48 |
| 2 Worker | 50 | 50 | 4.1s | **12.24 /秒** | 0.78s / 1.83s | 0.376s / 0.861s | 46 |
| 2 Worker | 100 | 52 | 14.4s | **6.93 /秒** | 1.20s / 1.65s | 0.496s / 1.419s | 75 |

原始数据：`load-test-1-worker.json`、`load-test-2-workers.json`、`load-test-2-workers-100.json`（同目录）。

## 3. 结论

**1. 50 并发没问题，P95 在 2 秒以内。**
两个 Worker 时 50 个任务 4.1 秒跑完，端到端 P95 1.83s，执行耗时 P95 0.861s。中间差的部分全部是审批往返。

**2. Worker 增加带来近线性收益，但不是线性。**
7.22 → 12.24 个/秒，约 1.7 倍。未翻倍的原因：任务领取是 `FOR UPDATE SKIP LOCKED` 的短事务，多 Worker 会互相争抢同一批待执行运行；同时审批回路仍由单客户端串行处理。

**3. 100 并发时吞吐反而下降，瓶颈是"容量"不是"算力"。**
- 即时只能分配 52 个，其余 48 个进入 `pending`；
- 履约类智能体并发上限之和是 `8 + 4 + 20 = 32`，这就是真正的并发天花板；
- 剩余任务依赖 Worker **每 5 秒一次**的重试分配，于是整体退化为"两批次"，总耗时 14.4s。

**4. 对"日均 1 万任务"的回答。**
日均 1 万 ≈ 0.12 个/秒，远低于实测 7–12 个/秒，**吞吐上不是瓶颈**；真正的风险是**突发峰值**：瞬时 100 个请求会排队约 10 秒。缓解手段是把履约类智能体的 `max_concurrency` 上调，或把重试分配周期从 5s 缩短到 1s，而不是加 Worker。

## 4. 压测发现的两个真实缺陷（已修复）

**缺陷一：同一任务被重复执行（50 个任务产生 54 个运行）**

`POST /tasks` 先把任务落库（`status=pending`），再调用调度创建运行。Worker 的重试分配恰好在这个窗口里扫到该任务、发现它没有运行，于是也建了一个运行——同一任务被执行两次。

修复：任务创建时先写 `status=dispatching`，重试分配只处理 `pending`，窗口关闭。
复测：50 个任务恰好 50 个运行。

**缺陷二：取消运行不更新任务状态**

`POST /runs/{id}/cancel` 只把运行置为 `canceled`，任务的 `status` 仍停在 `waiting_approval`。结果是列表里"已取消的运行"对应的任务看起来还在等审批，并且继续占用智能体并发额度。

修复：取消时同步任务状态（已成功/失败的任务不动）。
影响：修复前压测留下的 32 个陈旧状态做了一次数据订正。

## 5. 有效性说明（不能声称的部分）

| 项 | 说明 |
|---|---|
| 无真实模型时延 | 智能体调用是 Mock，耗时为 CPU+DB 级别；接真实模型后 P95 会上升一个量级 |
| 单个客户端 | 脚本在一台机器上一个进程发起，未排除客户端自身瓶颈 |
| 未测长稳态 | 每组只跑 50–100 个任务，没有 1 小时以上的稳定性测试 |
| 单机环境 | 全部容器在同一台笔记本上，数据库与 Worker 共享 CPU |
| 审批被自动化 | 人工审批的真实耗时（分钟级）没有纳入端到端统计 |

因此本报告只能说明**引擎与调度层的处理能力**，不能等同于生产容量。

## 6. 复现步骤

```powershell
# 单 Worker 基线
wsl -d Ubuntu-AgentMatrix -u root -- bash -lc "cd '/mnt/d/Document/毕业设计/agentmatrix-sc/infra' && docker compose up -d --scale worker=1"
node scripts/load-test.mjs --tasks 50 --label "1-worker"

# 两个 Worker
wsl -d Ubuntu-AgentMatrix -u root -- bash -lc "cd '/mnt/d/Document/毕业设计/agentmatrix-sc/infra' && docker compose up -d --scale worker=2"
node scripts/load-test.mjs --tasks 50 --label "2-workers"
node scripts/load-test.mjs --tasks 100 --label "2-workers-100"

# 复原
wsl -d Ubuntu-AgentMatrix -u root -- bash -lc "cd '/mnt/d/Document/毕业设计/agentmatrix-sc/infra' && docker compose up -d --scale worker=1"
```

> 压测会改变数据库状态（产生大量任务与运行）。演示前建议清理或重新 `dev seed`。
