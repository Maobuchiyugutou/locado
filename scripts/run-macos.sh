#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
APP_URL="http://localhost:1420"

echo "[Locado] Updating source with git pull --ff-only..."
git pull --ff-only

node_is_ready() {
  command -v node >/dev/null 2>&1 \
    && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'
}

install_node() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "[Locado] curl is required to install Node.js. Install Node.js 24+ from https://nodejs.org/."
    exit 1
  fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "[Locado] Installing nvm in your user directory..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 24
  nvm use 24
}

if ! node_is_ready; then
  install_node
fi
if ! node_is_ready || ! command -v npm >/dev/null 2>&1; then
  echo "[Locado] Node.js 24+ is unavailable. Open a new terminal and run this script again."
  exit 1
fi

node --version
npm --version

echo "[Locado] Installing project dependencies..."
npm ci --no-audit --no-fund

echo "[Locado] Building the production app..."
npm run build

echo "[Locado] Opening $APP_URL"
(
  sleep 2
  open "$APP_URL"
) &

echo "[Locado] Keep this terminal open. Press Ctrl+C to stop the server."
exec npm run preview -- --host 127.0.0.1 --port 1420 --strictPort
