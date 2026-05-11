@echo off
setlocal
REM Run this from your GFASORCL APPTEST clone (this folder should hold connection.config.json + config.yml).
set "APP=%~dp0"
cd /d "%APP%"

echo.
echo === GFASORCL APPTEST — clean restart ===
echo Folder: %APP%
echo Web UI: http://localhost:5173
findstr /i "clientName" "%APP%connection.config.json" 2>nul
echo.

set "PATH=%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\cloudflared;%ProgramFiles(x86)%\cloudflared;%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"

echo [1/4] Stopping demo ports only (keeping other tunnels untouched)...

echo [2/4] Stopping anything listening on 5173 (Vite) and 5002 (API)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(5173, 5002); foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Write-Host ('  PID ' + $_ + ' on port ' + $port); Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"

echo [3/4] Waiting 2 seconds...
timeout /t 2 /nobreak >nul

echo [4/4] Starting API (5002), Vite (host 0.0.0.0:5173), tunnel (.\config.yml)...
start "GFASORCL-API" /min /D "%APP%" cmd /k "set PORT=5002 && node server.cjs"
timeout /t 2 /nobreak >nul
start "GFASORCL-Vite" /min /D "%APP%" cmd /k "npm run dev -- --host 0.0.0.0 --port 5173"
timeout /t 2 /nobreak >nul
start "GFASORCL-Tunnel" /min /D "%APP%" cmd /k "cloudflared tunnel --config .\config.yml run"

echo.
echo Services started. If UI does not open correctly, close other dev servers and run again.
echo.
endlocal