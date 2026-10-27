#!/usr/bin/env bash
# 在 WSL(Linux 侧)准备并构建 Locado:装 Node(nvm)、复制项目到 ext4、npm install。
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

# --- 2) 复制项目源码到 ext4(~/Locado) ---
DEST="$HOME/Locado"
echo "=== copying project to $DEST ==="
mkdir -p "$DEST"
for f in src index.html package.json tsconfig.json vite.config.ts README.md; do
  if [ -e "/mnt/e/Locado/$f" ]; then cp -r "/mnt/e/Locado/$f" "$DEST/"; fi
done
ls -1 "$DEST"

# --- 3) 安装依赖 ---
cd "$DEST" || exit 1
echo "=== npm install ==="
npm install --no-audit --no-fund || { echo "NPM_INSTALL_FAILED"; exit 1; }

echo "SETUP_DONE node_modules=$(test -d node_modules && echo yes || echo no)"
