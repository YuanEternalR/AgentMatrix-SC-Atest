# AgentMatrix-SC · 面向供应链的智能体矩阵工作台

> 毕业设计项目。主线是**系统**（智能体矩阵工作台），研究点是**调度策略**（大模型规划 / 小模型与 skill 执行的分配机制）。

## 当前状态（诚实标注）

| 模块 | 状态 | 验证方式 |
|---|---|---|
| 调度策略层（5 策略 + 硬过滤 + 可解释打分 + 注册表） | ✅ 已实现 | 32 条单测通过 |
| 离线评测 harness（仿真执行器、指标、报告生成） | ✅ 已实现 | `scripts/evaluate_strategies.py` 产出 `docs/experiments/` |
| 论文用策略对比结论 | ✅ 已成型 | `docs/dispatch-strategy.md` |
| WSL2 + Docker Engine 环境 | ✅ 已就绪 | `docker run hello-world` 通过，镜像加速生效 |
| Compose 编排（Postgres 16 / Redis 7 / API） | ✅ 已跑通 | 三容器 healthy，`/health` 返回 `{"database":"ok","redis":"ok"}` |
| 数据模型（11 张表）与 Alembic 迁移 | ✅ 已实现 | `alembic upgrade head` 成功，`\dt` 见 12 张表 |
| FastAPI 骨架（`/health`、`/api/v1/meta`、`/docs`） | ✅ 已实现 | 三个端点实测 HTTP 200 |
| 登录 / RBAC / 任务路由 / Worker / 前端 | ⬜ 未开始 | — |

**尚未验证的部分不会写成"已完成"**，未跑通的一律标 ⬜。

## 启动

```powershell
# 首次：复制环境变量
Copy-Item .env.example .env

# 启动全栈（需在 WSL 内执行 docker 命令）
wsl -d Ubuntu-AgentMatrix -u root -- bash -lc "cd '/mnt/d/Document/毕业设计/agentmatrix-sc/infra' && docker compose up -d --build"

# 建表
wsl -d Ubuntu-AgentMatrix -u root -- bash -lc "cd '/mnt/d/Document/毕业设计/agentmatrix-sc/infra' && docker compose exec -T api alembic upgrade head"

# 验证
curl http://127.0.0.1:8000/health
```

API 文档：http://127.0.0.1:8000/docs

## 快速开始（当前可跑的部分）

环境要求：Python 3.11+（开发机为 3.14.7，调度层不依赖第三方库）。

```bash
# 1. 跑单测
python -m pytest

# 2. 生成策略对比报告
python scripts/evaluate_strategies.py --count-per-type 8
```

产物：
- `docs/experiments/dispatch-comparison.md`
- `docs/experiments/dispatch-comparison-<utc>.csv`

## 目录

```
agentmatrix-sc/
├─ apps/
│  └─ api/app/services/dispatch/   # 调度层（已完成）
├─ docs/
│  ├─ dispatch-strategy.md         # 设计 + 实验 + 有效性威胁
│  └─ experiments/                 # 脚本生成的对比报告
├─ scripts/evaluate_strategies.py  # 离线评测入口
└─ tests/unit/                     # 32 条单测
```

## 调度策略一览

| 编号 | 策略 | 一句话 |
|---|---|---|
| S0 | 全大模型 | 质量上限基线 |
| S1 | 固定规则 | 注册顺序，下界基线 |
| S2 | 加权打分 | 六因子线性加权，产品默认 |
| S3 | SLA 成本优先 | 质量下限 + SLA 余量后取最低成本 |
| S4 | 大模型规划 + 规则校验 | 规划器只能在**可行集**内挑，无权绕过硬过滤 |

详细设计与实验结论见 [docs/dispatch-strategy.md](docs/dispatch-strategy.md)。

## 环境前置（实测路线，进行中）

本机实测：`desktop.docker.com` 不可达、Docker Hub 被墙，因此**不装 Docker Desktop**，改为 WSL2 + Docker Engine（清华源 + 国内镜像加速）。

当前状态：
- ✅ 虚拟机平台功能已启用，**等待一次重启**生效（`vmcompute` 服务尚未出现）
- ✅ Ubuntu 24.04 rootfs 已下载到 `D:\WSL\`（340 MB）
- ⬜ `wsl --import` 与 Docker Engine 安装（重启后一条命令完成）

重启后执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\01-provision-wsl-docker.ps1
```

完整探测数据、选型理由与回滚步骤见 [docs/environment-setup.md](docs/environment-setup.md)。

## 约定

- UI 文案简体中文，代码与注释英文，文档中文。
- 不硬编码演示数据到组件；数据来自数据库与种子脚本。
- 不伪造运行结果、测试结果与截图；无法验证的内容标注未验证。
