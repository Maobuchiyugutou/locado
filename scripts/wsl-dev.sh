#!/usr/bin/env bash
# 启动 Vite dev server(在 ~/Locado,ext4)。保持前台运行。
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null 2>&1
cd "$HOME/Locado" || exit 1
exec npm run dev
