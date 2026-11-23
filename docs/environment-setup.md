# 环境搭建（实测版）

> 本文记录本机（Windows 11 家庭版 26300）上的**实际探测结果**与安装步骤。
> 结论先行：**本机已按此路线装好并验证通过**——不装 Docker Desktop，改在 WSL2 里装 Docker Engine（`Ubuntu-AgentMatrix` + Docker Engine + 镜像加速 + `docker compose`）；原因仍是 `desktop.docker.com` 在本机网络不可达。
>
> **当前状态（2026-11-23）**：已安装完成、长期可用，见第 8 节「当前环境现状」。第 1–2 节的「卡点」是首次安装前的探测记录，保留作历史证据。

## 1. 首次安装前的实测环境与卡点（历史记录）

| 项 | 实测结果 | 判定 |
|---|---|---|
| Windows | 11 家庭版 10.0.26300，64 位 | ✅ |
| BIOS 虚拟化 | `VirtualizationFirmwareEnabled = True` | ✅ |
| Hypervisor | `HypervisorPresent = True` | ✅ |
| VirtualMachinePlatform | `InstallState = 1`（已启用） | ✅ |
| Microsoft-Windows-Subsystem-Linux | `InstallState = 2`（未启用） | 非必需（Store 版 WSL 不依赖） |
| **vmcompute 服务** | **不存在** | ❌ 卡点 |
| **挂起重启** | `RebootPending(CBS) = True`，`PendingFileRename = True` | ❌ 卡点根因 |
| 最后一次启动 | 2026-11-16 15:45 | 功能已写入但未生效 |
| Docker Desktop | 未安装 | ❌ |
| winget | 不存在 | ❌ 无法静默安装 |

> 这张表是**安装前**的状态。重启后 `vmcompute` 服务出现，`wsl --import` 与 Docker 安装均成功；现在日常使用不需要再处理表中任何一项。

**证据链**：`wsl --import` 报 `HCS_E_SERVICE_NOT_AVAILABLE`（主机计算服务不可用），而 `vmcompute` 服务不存在 —— 虚拟机平台的功能已登记、配置未提交，**必须重启一次**。`wsl --status` 里那句"未启用虚拟机平台"是误导性文案。（重启后该报错消失，导入成功。）

## 2. 网络探测（决定了技术选型）

| 目标 | 结果 | 含义 |
|---|---|---|
| `pypi.org` / `registry.npmjs.org` | 200 | 依赖可装 |
| `raw.githubusercontent.com` | 200 | 可访问 |
| `desktop.docker.com` | 连接被重置 | **不能装 Docker Desktop** |
| `registry-1.docker.io` | 超时 | **Docker Hub 被墙，必须配镜像加速** |
| `docker.m.daocloud.io` | 401（正常鉴权质询） | ✅ 可用镜像源 |
| `docker.1ms.run` | 401（正常鉴权质询） | ✅ 可用镜像源 |
| `mirrors.tuna.tsinghua.edu.cn` | 200 | ✅ apt 与 Docker CE 源 |
| `mirrors.aliyun.com` | 200 | 备选 apt 源 |
| 本机代理 `127.0.0.1:7897` | 端口未监听 | 代理未运行，不走代理 |

## 3. 安装路线

```
启用虚拟机平台(已完成) → 重启 → 导入 Ubuntu 24.04 rootfs → apt 装 Docker Engine(清华源)
  → 配置 registry-mirrors → systemd 启动 → docker run hello-world 验证
```

> 本机已走完整条路线；下面是留给新机器/重装时的步骤。

**为什么不装 Docker Desktop**：官方安装包域名不可达；且 Desktop 对 500 人以上企业有授权限制。WSL2 + Docker Engine 功能等价（含 `docker compose v2`），体积小、纯开源。

**为什么不从应用商店装发行版**：`wsl --list --online` 走 WinINET 拉 GitHub 的 DistributionInfo.json，本机超时；改用 Ubuntu 官方云镜像的 rootfs 直接 `wsl --import`，绕开商店与 WinINET。

## 4. 操作步骤

### 步骤 1：重启电脑（当时必需，已完成；新机器才需要再做一次）

当时 Windows 功能已启用但未生效；重启后 `vmcompute` 服务出现，`wsl --import` 成功。本机这一步已完成，不需要再重启。

### 步骤 2：一键导入并安装 Docker

重启后执行（**不需要管理员权限**，幂等，可重复跑）：

```powershell
cd "D:\Document\毕业设计\agentmatrix-sc"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\01-provision-wsl-docker.ps1
```

脚本做五件事：
1. 校验 `vmcompute` 是否已生效（没有就提示你重启）；
2. 从 `D:\WSL\ubuntu-24.04-wsl.rootfs.tar.gz` 导入发行版 `Ubuntu-AgentMatrix`；
3. 在发行版内跑 `install-docker.sh`（apt 换清华源、装 docker-ce、写 `daemon.json` 镜像加速）；
4. `wsl --shutdown` 使 systemd 生效；
5. `docker run --rm hello-world` 端到端验证（这一步同时验证镜像加速）。

### 步骤 3：验证清单

```powershell
wsl -d Ubuntu-AgentMatrix -u root -- bash -lc "docker --version && docker compose version && docker info | grep -A2 'Registry Mirrors'"
wsl -d Ubuntu-AgentMatrix -u root -- bash -lc "docker run --rm hello-world"
```

全部通过才进入下一阶段（数据模型 + Compose）。

## 5. 已下载的资产

| 文件 | 大小 | 用途 |
|---|---|---|
| `D:\WSL\ubuntu-24.04-wsl.rootfs.tar.gz` | 340 MB | Ubuntu 24.04 根文件系统，用于 `wsl --import` |
| `D:\WSL\Ubuntu-AgentMatrix\` | 导入后生成 | 发行版虚拟磁盘所在地 |

## 6. 回滚

```powershell
# 注销发行版（删除其虚拟磁盘）
wsl --unregister Ubuntu-AgentMatrix
Remove-Item 'D:\WSL\Ubuntu-AgentMatrix' -Recurse -Force
Remove-Item 'D:\WSL\ubuntu-24.04-wsl.rootfs.tar.gz' -Force
```

关闭虚拟机平台功能（**需要管理员**，且会影响其他 WSL 用法）：

```powershell
dism.exe /online /disable-feature /featurename:VirtualMachinePlatform /norestart
```

## 7. 已知限制（写进论文的"环境说明"）

1. 导入的发行版默认以 **root** 运行，仅用于本地演示沙箱，不作为生产配置。
2. 项目代码位于 `/mnt/d/...`（Windows 盘），bind mount 的文件 I/O 比 WSL 原生 ext4 慢；因此 PostgreSQL 数据卷使用命名卷而非宿主机目录。
3. 镜像加速源可用性随网络状况变化；若 `hello-world` 拉取失败，先换 `daemon.json` 里的镜像地址。
4. 没有 Docker Desktop，Windows 侧**没有** `docker` 命令；所有容器命令通过 `wsl -d Ubuntu-AgentMatrix -- docker ...` 执行。
5. 若后续需要 Windows 侧直连 docker CLI，可设置 `DOCKER_HOST` 或安装 Desktop，但不是本项目的必需项。

## 8. 当前环境现状（2026-11-23）

安装已完成并长期可用（2026-11 起）。当前这套发行版与 Docker 配置的时间戳为 2026-11-21（就位时间），此后未重装；日常只需 `dev up`。

| 项 | 现状 |
|---|---|
| WSL | WSL2，默认发行版 `Ubuntu-AgentMatrix`（Ubuntu 24.04 LTS），已导入并运行 |
| Docker | Docker Engine 29.10.0 + Compose v5.8.0，systemd 开机自启（`enabled`），镜像加速为 `docker.m.daocloud.io` / `docker.1ms.run` |
| 容器 | 5 个：api / worker / web / postgres / redis 均在运行；api、postgres、redis 带 healthcheck（healthy），web、worker 无 healthcheck（显示 `Up` 即正常） |
| 端口 | 前端 5173、接口 8000、Postgres 5433、Redis 6380（均只绑定 127.0.0.1） |
| 启动 | `dev up` = `docker compose up -d` + 一个隐藏的 WSL 常驻会话（`wsl ... sleep infinity`）；`dev ps` 同时显示容器状态与常驻会话 PID，`dev down` 一并结束 |
| 闲置回收 | `%USERPROFILE%\.wslconfig` 设了 `vmIdleTimeout=86400000`（24 小时），避免默认约 1 分钟回收导致容器反复重启 |
| 健康检查 | `dev health` 返回 `{"status":"ok","checks":{"database":"ok","redis":"ok"}}` |

> 工作台（`agentmatrix-workbench\start.cmd`）打开时会自动拉起平台（仓库根目录 `dev.cmd up`）和 DSH 引擎（端口 3083），不需要先手动 `dev up`；设 `AM_PLATFORM=0` 可只复用已在跑的平台。

**日常不用再执行的步骤**：重启电脑、重新 `wsl --import`、重装 Docker、手动 `wsl --shutdown`。只有换机器或执行过 `wsl --unregister` 之后，才需要从第 4 节重来。
