@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Locado Setup
cd /d "%~dp0\.." || exit /b 1

echo [Locado] Checking Node.js 24 or newer...
where node >nul 2>&1
if errorlevel 1 goto install_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto install_node
goto node_ready

:install_node
where winget >nul 2>&1
if errorlevel 1 goto node_manual
echo [Locado] Installing Node.js LTS with winget...
winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto node_manual
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 goto node_restart
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto node_restart

:node_ready
where npm >nul 2>&1
if errorlevel 1 goto node_restart
node --version
call npm --version

echo [Locado] Installing project dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 goto fail

echo [Locado] Building the production app...
call npm run build
if errorlevel 1 goto fail

echo [Locado] Opening http://localhost:1420
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:1420'"
echo [Locado] Keep this window open. Press Ctrl+C to stop the server.
call npm run preview -- --host 127.0.0.1 --port 1420 --strictPort
if errorlevel 1 goto fail
exit /b 0

:node_manual
echo [Locado] Node.js 24+ could not be installed automatically.
echo Install it from https://nodejs.org/ and run this script again.
pause
exit /b 1

:node_restart
echo [Locado] Node.js was installed, but this terminal cannot use it yet.
echo Close this window, open a new terminal, and run the script again.
pause
exit /b 1

:fail
echo [Locado] Setup or startup failed. Review the messages above.
pause
exit /b 1
