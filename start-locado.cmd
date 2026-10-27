@echo off
setlocal
set URL=http://localhost:1420/
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%URL%'; function Up { try { return (Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 1).StatusCode -eq 200 } catch { return $false } }; if (-not (Up)) { Start-Process wsl -ArgumentList '-d','Ubuntu','--','bash','/mnt/e/Locado/wsl-serve.sh' | Out-Null; for ($i = 0; $i -lt 240; $i++) { if (Up) { break }; Start-Sleep -Milliseconds 500 } }; Start-Process $u"
endlocal
