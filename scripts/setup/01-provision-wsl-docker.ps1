# AgentMatrix-SC · 一键准备 WSL2 + Docker Engine
#
# 前置：已重启电脑（虚拟机平台功能的配置需重启才生效）。
# 本脚本不需要管理员权限，可重复执行（幂等）。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\01-provision-wsl-docker.ps1
#
# 做了什么：
#   1. 校验 WSL2 主机计算服务（vmcompute）是否已生效；
#   2. 从本地 rootfs 导入 Ubuntu 24.04 发行版（不依赖应用商店）；
#   3. 在发行版内执行 install-docker.sh（清华源 + 镜像加速）；
#   4. 重启 WSL 使 systemd 生效，并做端到端验证。

[CmdletBinding()]
param(
    [string]$Rootfs = 'D:\WSL\ubuntu-24.04-wsl.rootfs.tar.gz',
    [string]$Target = 'D:\WSL\Ubuntu-AgentMatrix',
    [string]$Distro = 'Ubuntu-AgentMatrix'
)

$ErrorActionPreference = 'Stop'
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- 0. 前置校验 ----------------------------------------------------------
Step '0/5 校验前置条件'

if (-not (Test-Path $Rootfs)) {
    throw "找不到发行版镜像：$Rootfs。请先下载 ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz。"
}

$vmcompute = Get-Service -Name vmcompute -ErrorAction SilentlyContinue
if (-not $vmcompute) {
    throw @"
WSL2 的主机计算服务(vmcompute)仍不存在，虚拟机平台功能尚未生效。
请先重启电脑，再重新运行本脚本。
"@
}
Write-Host "  vmcompute: $($vmcompute.Status)" -ForegroundColor Green

# --- 1. 导入发行版 --------------------------------------------------------
Step "1/5 导入发行版 $Distro"

$existing = (& wsl -l -q 2>$null) -replace "`0", '' |
    ForEach-Object { $_.Trim() } | Where-Object { $_ }
if ($existing -contains $Distro) {
    Write-Host "  已存在，跳过导入" -ForegroundColor Yellow
} else {
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    & wsl --import $Distro $Target $Rootfs --version 2
    if ($LASTEXITCODE -ne 0) { throw "wsl --import 失败，退出码 $LASTEXITCODE" }
    Write-Host "  导入完成" -ForegroundColor Green
}

# --- 2. 准备安装脚本 ------------------------------------------------------
Step '2/5 准备安装脚本'

$installer = Join-Path $PSScriptRoot 'install-docker.sh'
if (-not (Test-Path $installer)) { throw "找不到 install-docker.sh：$installer" }

# 复制到纯英文路径，避免中文路径在 bash 中解析出错
$staged = 'D:\WSL\install-docker.sh'
Copy-Item $installer $staged -Force
Write-Host "  已暂存到 $staged" -ForegroundColor Green

# --- 3. 安装 Docker -------------------------------------------------------
Step '3/5 在 WSL 内安装 Docker Engine（首次约 3-5 分钟）'

& wsl -d $Distro -u root -- bash /mnt/d/WSL/install-docker.sh
if ($LASTEXITCODE -ne 0) { throw "Docker 安装失败，退出码 $LASTEXITCODE" }

# --- 4. 重启 WSL 使 systemd 生效 -----------------------------------------
Step '4/5 重启 WSL 以启用 systemd'

& wsl --shutdown
Start-Sleep -Seconds 3
& wsl -d $Distro -u root -- bash -lc 'systemctl is-active docker'
if ($LASTEXITCODE -ne 0) {
    Write-Host '  systemd 未接管 docker，尝试手动启动' -ForegroundColor Yellow
    & wsl -d $Distro -u root -- bash -lc 'service docker start || dockerd >/dev/null 2>&1 &'
    Start-Sleep -Seconds 5
}

# --- 5. 端到端验证 --------------------------------------------------------
Step '5/5 端到端验证（含镜像加速拉取）'

& wsl -d $Distro -u root -- bash -lc @'
set -e
echo "--- 版本 ---"
docker --version
docker compose version
echo "--- 守护进程 ---"
docker info --format '存储驱动={{.Driver}}  镜像加速={{.RegistryConfig.Mirrors}}'
echo "--- 拉取测试镜像（验证镜像加速是否生效）---"
docker run --rm hello-world
'@

if ($LASTEXITCODE -ne 0) { throw "端到端验证失败，退出码 $LASTEXITCODE" }

Step '全部完成'
Write-Host "  WSL 发行版：$Distro"
Write-Host "  进入方式：wsl -d $Distro"
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Write-Host "  项目路径：$repo（WSL 内对应 /mnt/<盘符小写>/...）"
