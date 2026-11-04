@echo off
setlocal
set URL=http://localhost:1420/
echo [Locado] Updating source and building the latest app...
wsl -d Ubuntu -- bash /mnt/e/Locado/scripts/wsl-serve.sh --build-only
if errorlevel 1 goto fail

powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%URL%'; $expected = ((wsl -d Ubuntu -- bash -lc 'command cat $HOME/Locado/dist/version.json') | ConvertFrom-Json).build; function Up { try { return (Invoke-RestMethod -Uri ($u + 'version.json') -TimeoutSec 5).build -eq $expected } catch { return $false } }; function Responding { try { Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 5 | Out-Null; return $true } catch { return $false } }; if (-not (Up)) { if (Responding) { Write-Host '[Locado] Port 1420 is serving a different build. Stop that process and run this launcher again.'; exit 1 }; Start-Process wsl -ArgumentList '-d','Ubuntu','--','bash','/mnt/e/Locado/scripts/wsl-serve.sh','--serve-only' | Out-Null; for ($i = 0; $i -lt 240; $i++) { if (Up) { break }; Start-Sleep -Milliseconds 500 } }; if (-not (Up)) { Write-Host '[Locado] The updated app did not become ready on port 1420.'; exit 1 }; Start-Process $u"
if errorlevel 1 goto fail
endlocal
exit /b 0

:fail
echo [Locado] Update or startup failed. Review the messages above.
pause
exit /b 1
