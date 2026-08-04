@echo off
REM Started by Windows Task Scheduler (GFAS-*-AppStack).
REM Prefer grainfas_start_Services.bat (API + production preview + tunnel, background).
REM Logs: logs\grainfas-stack.log , logs\server.log , logs\frontend.log , logs\tunnel.log

cd /d "%~dp0"
if not exist logs mkdir logs

set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\cloudflared"

echo [%date% %time%] Autostart: launching Grainfas stack...>> logs\autostart-stack.log

if exist "%~dp0grainfas_start_Services.bat" (
  call "%~dp0grainfas_start_Services.bat"
  echo [%date% %time%] grainfas_start_Services.bat launched.>> logs\autostart-stack.log
  exit /b 0
)

REM Fallback if grainfas bat is missing
echo [%date% %time%] grainfas_start_Services.bat missing - using legacy windows.>> logs\autostart-stack.log
start "GFAS-API" /MIN cmd /c "set PORT=5002 && node server.cjs >> logs\server.log 2>&1"
timeout /t 2 /nobreak >nul
start "GFAS-Web" /MIN cmd /c "npm.cmd run preview -- --host 0.0.0.0 --port 5173 --strictPort >> logs\frontend.log 2>&1"
timeout /t 2 /nobreak >nul
start "GFAS-Tunnel" /MIN cmd /c "cloudflared tunnel --config config.yml run >> logs\tunnel.log 2>&1"
echo [%date% %time%] Legacy launch done.>> logs\autostart-stack.log
exit /b 0
