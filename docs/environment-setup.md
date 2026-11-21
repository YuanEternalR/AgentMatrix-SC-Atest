# 环境搭建（实测版）

> 本文记录本机（Windows 11 家庭版 26300）上的**实际探测结果**与安装步骤。
> 结论先行：**不装 Docker Desktop**，改在 WSL2 里装 Docker Engine —— 因为 `desktop.docker.com` 在本机网络不可达。

## 1. 实测环境与卡点

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

**证据链**：`wsl --import` 报 `HCS_E_SERVICE_NOT_AVAILABLE`（主机计算服务不可用），而 `vmcompute` 服务不存在 —— 虚拟机平台的功能已登记、配置未提交，**必须重启一次**。`wsl --status` 里那句"未启用虚拟机平台"是误导性文案。

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

**为什么不装 Docker Desktop**：官方安装包域名不可达；且 Desktop 对 500 人以上企业有授权限制。WSL2 + Docker Engine 功能等价（含 `docker compose v2`），体积小、纯开源。

**为什么不从应用商店装发行版**：`wsl --list --online` 走 WinINET 拉 GitHub 的 DistributionInfo.json，本机超时；改用 Ubuntu 官方云镜像的 rootfs 直接 `wsl --import`，绕开商店与 WinINET。

## 4. 操作步骤

### 步骤 1：重启电脑（必须，只需一次）

Windows 功能已启用但未生效。重启后 `vmcompute` 服务才会出现。

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
