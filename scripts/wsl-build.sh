#!/usr/bin/env bash
# 在 WSL(Linux 侧)准备并构建 Locado:装 Node(nvm)、复制项目到 ext4、npm ci。
set -u

echo "=== distro ==="
. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"

echo "=== base tools ==="
for t in curl git; do printf '%s: ' "$t"; command -v "$t" >/dev/null && echo ok || echo MISSING; done

# --- 1) nvm + Node LTS(全部写在 $HOME,无需 sudo) ---
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "=== installing nvm ==="
  curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash || { echo "NVM_INSTALL_FAILED"; exit 1; }
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "=== installing Node LTS ==="
  nvm install --lts || { echo "NODE_INSTALL_FAILED"; exit 1; }
fi
nvm use --lts >/dev/null 2>&1 || true
echo "node: $(node -v)   npm: $(npm -v)"

# --- 2) 全量同步源码并安装依赖 ---
bash /mnt/e/Locado/scripts/wsl-run.sh || { echo "SETUP_FAILED"; exit 1; }

# --- 3) 类型检查与生产构建 ---
cd "$HOME/Locado" || exit 1
npm run build || { echo "BUILD_FAILED"; exit 1; }
