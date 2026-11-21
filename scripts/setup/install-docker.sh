# AgentMatrix-SC · WSL 内 Docker Engine 安装脚本（Ubuntu 24.04）
#
# 设计约束（基于本机实测）：
#   1. Docker Hub (registry-1.docker.io) 在本机网络不可达，必须配置镜像加速；
#   2. desktop.docker.com 不可达，因此不装 Docker Desktop，只装 Docker Engine；
#   3. 全部走国内镜像源，避免在 apt / 拉镜像阶段卡死。
#
# 用法：以 root 在 WSL 发行版内执行
#   bash /mnt/d/WSL/install-docker.sh

set -euo pipefail

TUNA="https://mirrors.tuna.tsinghua.edu.cn"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

log "1/6 检查发行版"
. /etc/os-release
echo "  ${PRETTY_NAME} (${VERSION_CODENAME})"

log "2/6 切换 apt 源到清华镜像"
if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
  # Ubuntu 24.04 起使用 deb822 格式
  sed -i \
    -e "s|http://archive.ubuntu.com/ubuntu|${TUNA}/ubuntu|g" \
    -e "s|http://security.ubuntu.com/ubuntu|${TUNA}/ubuntu|g" \
    -e "s|https://archive.ubuntu.com/ubuntu|${TUNA}/ubuntu|g" \
    /etc/apt/sources.list.d/ubuntu.sources || true
fi
if [ -f /etc/apt/sources.list ]; then
  sed -i \
    -e "s|http://archive.ubuntu.com/ubuntu|${TUNA}/ubuntu|g" \
    -e "s|http://security.ubuntu.com/ubuntu|${TUNA}/ubuntu|g" \
    /etc/apt/sources.list || true
fi

log "3/6 安装基础依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg jq >/dev/null

log "4/6 添加 Docker CE 官方仓库（清华镜像）"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "${TUNA}/docker-ce/linux/ubuntu/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] ${TUNA}/docker-ce/linux/ubuntu ${VERSION_CODENAME} stable
EOF

apt-get update -qq
apt-get install -y -qq \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin >/dev/null

log "5/6 配置镜像加速与日志轮转"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "features": { "containerd-snapshotter": false }
}
EOF

log "6/6 启用 systemd 服务并启动 Docker"
mkdir -p /etc
if ! grep -q '^\[boot\]' /etc/wsl.conf 2>/dev/null; then
  cat > /etc/wsl.conf <<'EOF'
[boot]
systemd=true

[interop]
enabled=true

[automount]
enabled=true
options="metadata,umask=22,fmask=11"
EOF
else
  sed -i '/^\[boot\]/,/^\[/ s/^systemd=.*/systemd=true/' /etc/wsl.conf
  grep -q '^systemd=true' /etc/wsl.conf || sed -i 's/^\[boot\]/[boot]\nsystemd=true/' /etc/wsl.conf
fi

systemctl enable docker >/dev/null 2>&1 || true
systemctl start docker || service docker start || true

log "验证"
docker --version
docker compose version
docker info 2>/dev/null | grep -A2 'Registry Mirrors' || true
echo
echo "Docker Engine 安装完成。"
