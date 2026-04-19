@echo off
REM Started by Windows Task Scheduler (GFAS-*-AppStack). Starts API, Vite dev, Cloudflare tunnel.
REM Logs: logs\server.log, logs\frontend.log, logs\tunnel.log, logs\autostart-stack.log

cd /d "%~dp0"
if not exist logs mkdir logs

set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\cloudflared"

echo [%date% %time%] Starting API ^+ Vite ^+ tunnel...>> logs\autostart-stack.log

start "GFAS-API" /MIN cmd /c "node server.cjs >> logs\server.log 2>&1"
timeout /t 2 /nobreak >nul
start "GFAS-Web" /MIN cmd /c "npm.cmd run dev -- --host 0.0.0.0 --port 5173 >> logs\frontend.log 2>&1"
timeout /t 2 /nobreak >nul
start "GFAS-Tunnel" /MIN cmd /c "cloudflared tunnel --config config.yml run >> logs\tunnel.log 2>&1"

echo [%date% %time%] Launched child windows.>> logs\autostart-stack.log
exit /b 0
