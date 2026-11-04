#!/usr/bin/env bash
set -e
# 一键上线:同步 E:\Locado → ~/Locado,构建生产版本,并在 1420 端口提供服务。
# --build-only 只更新并构建;--serve-only 只启动已有构建,供 Windows 入口分阶段调用。
# 固定 1420 是为了和原来的 dev server 同源(http://localhost:1420),
# localStorage 数据不会因为换端口而"消失"。
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 24 >/dev/null

MODE="${1:-all}"
case "$MODE" in
  all|--build-only|--serve-only) ;;
  *) echo "[Locado] 未知启动模式: $MODE"; exit 2 ;;
esac

SRC="/mnt/e/Locado"
DEST="$HOME/Locado"
if [ "$MODE" != "--serve-only" ]; then
  echo "[Locado] 正在通过 git pull --ff-only 更新源码..."
  git -C "$SRC" pull --ff-only || exit 1

  mkdir -p "$DEST"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .vscode \
    --exclude .claude \
    --exclude 'wsl-*.sh' \
    --exclude 'start-locado.cmd' \
    "$SRC"/ "$DEST"/ || exit 1

  cd "$DEST" || exit 1
  npm ci --no-audit --no-fund || exit 1
  npm run build || exit 1
fi

if [ "$MODE" = "--build-only" ]; then
  echo "[Locado] 最新构建已完成。"
  exit 0
fi

cd "$DEST" || exit 1
echo "Locado 已构建,正在 http://localhost:1420 提供服务(保持此窗口开启)"
exec npm run preview -- --port 1420 --strictPort
