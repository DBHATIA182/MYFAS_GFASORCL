@echo off
setlocal
REM Grainfas (GFASORCL) — free ports, then start API + Web + Tunnel in background.
REM This window closes immediately; progress goes to logs\grainfas-stack.log
set "APP=%~dp0"
if "%APP:~-1%"=="\" set "APP=%APP:~0,-1%"
cd /d "%APP%"

start "" /b powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%APP%\Start-GrainfasStack.ps1" -AppRoot "%APP%" -ProductionWeb

endlocal
exit /b 0
