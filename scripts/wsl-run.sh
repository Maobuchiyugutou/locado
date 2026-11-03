#!/usr/bin/env bash
set -e
# 以 E:\Locado 为唯一源码,整目录同步到 WSL 的 ext4 副本(~/Locado),再装依赖。
# 用 rsync --delete 全量镜像,新增/删除的文件都会跟上;node_modules 只存在于 WSL,
# 不参与同步,所以不会被删掉。package-lock.json 随源码同步,供 npm ci 使用。
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 24 >/dev/null
echo "node: $(node -v)   npm: $(npm -v)"

SRC="/mnt/e/Locado"
DEST="$HOME/Locado"
mkdir -p "$DEST"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .vscode \
  --exclude .claude \
  --exclude 'wsl-*.sh' \
  --exclude 'start-locado.cmd' \
  "$SRC"/ "$DEST"/
echo "synced files:"; ls -1 "$DEST"

cd "$DEST" || exit 1
echo "=== npm ci ==="
npm ci --no-audit --no-fund
echo "SETUP_DONE node_modules=$(test -d node_modules && echo yes || echo no)"
