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

set "CLOUDFLARED_EXE="
if exist "%ProgramFiles%\Cloudflared\cloudflared.exe" set "CLOUDFLARED_EXE=%ProgramFiles%\Cloudflared\cloudflared.exe"
if not defined CLOUDFLARED_EXE if exist "%ProgramFiles(x86)%\Cloudflared\cloudflared.exe" set "CLOUDFLARED_EXE=%ProgramFiles(x86)%\Cloudflared\cloudflared.exe"

echo [1/6] Closing existing GFASORCL terminal windows (API / Vite / Tunnel)...
taskkill /FI "WINDOWTITLE eq GFASORCL-API*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GFASORCL-Vite*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq GFASORCL-Tunnel*" /F >nul 2>&1

echo [2/6] Stopping node, cloudflared, and ports 5002 + 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { Set-Location -LiteralPath '%APP%'; & '.\stop-apptest-services.ps1' -ReleasePorts @(5002,5173) -WaitSeconds 1 }"
if errorlevel 1 (
  echo WARNING: stop-apptest-services.ps1 reported an error; continuing with port cleanup...
)

echo [3/6] Stopping Cloudflared service + stray tunnel processes...
net stop Cloudflared >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1

echo [4/6] Waiting 2 seconds for handles to release...
timeout /t 2 /nobreak >nul

echo [5/6] Clearing Vite cache (fixes stale JS / missing exports)...
if exist "%APP%node_modules\.vite" rmdir /s /q "%APP%node_modules\.vite" 2>nul

echo [6/6] Starting API (5002), Vite (host 0.0.0.0:5173), tunnel (.\config.yml — /api goes to :5002)...
start "GFASORCL-API" /min /D "%APP%" cmd /k "set PORT=5002 && node server.cjs"
timeout /t 2 /nobreak >nul
start "GFASORCL-Vite" /min /D "%APP%" cmd /k "npm run dev -- --host 0.0.0.0 --port 5173"
timeout /t 2 /nobreak >nul
if not defined CLOUDFLARED_EXE (
  echo ERROR: cloudflared.exe not found.
  pause
  exit /b 1
)
start "GFASORCL-Tunnel" /min /D "%APP%" cmd /k ""%CLOUDFLARED_EXE%" tunnel --config .\config.yml run"

echo.
echo Services started in new terminals: GFASORCL-API, GFASORCL-Vite, GFASORCL-Tunnel
echo (minimized). Restore them from the taskbar if you need to see logs.
echo.
endlocal
