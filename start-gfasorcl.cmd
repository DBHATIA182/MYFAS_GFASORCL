@echo off
REM GFASORCL\APPTEST — stop old API/Vite, start API :5002 + Vite :5173 + tunnel
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs

REM Real cloudflared is under Program Files — NOT C:\Windows\System32\cloudflared.exe (often wrong/broken).
set "PATH=%ProgramFiles%\Cloudflared;%ProgramFiles(x86)%\Cloudflared;%ProgramFiles%\cloudflared;%ProgramFiles(x86)%\cloudflared;%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"

set "CLOUDFLARED_EXE="
if exist "%ProgramFiles%\Cloudflared\cloudflared.exe" set "CLOUDFLARED_EXE=%ProgramFiles%\Cloudflared\cloudflared.exe"
if not defined CLOUDFLARED_EXE if exist "%ProgramFiles(x86)%\Cloudflared\cloudflared.exe" set "CLOUDFLARED_EXE=%ProgramFiles(x86)%\Cloudflared\cloudflared.exe"
if not defined CLOUDFLARED_EXE if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CLOUDFLARED_EXE=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CLOUDFLARED_EXE if exist "%~dp0cloudflared.exe" set "CLOUDFLARED_EXE=%~dp0cloudflared.exe"
if not defined CLOUDFLARED_EXE (
  echo ERROR: cloudflared.exe not found. Install: winget install Cloudflare.cloudflared
  pause
  exit /b 1
)

echo [%date% %time%] GFASORCL start>> logs\start-gfasorcl.log
echo Using cloudflared: %CLOUDFLARED_EXE%

echo Stopping Cloudflared service + extra tunnels (needs Admin for service stop)...
net stop Cloudflared >nul 2>&1
if errorlevel 1 echo   Tip: run stop-cloudflared-service-admin.cmd as Administrator once.
taskkill /F /IM cloudflared.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Stopping listeners on ports 5001, 5002, 5173...
for %%P in (5001 5002 5173) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
    echo   Killing PID %%a on port %%P
    taskkill /F /PID %%a >nul 2>&1
  )
)
timeout /t 2 /nobreak >nul

echo Starting API on port 5002...
start "GFASORCL-API" cmd /k "cd /d %~dp0 && set PORT=5002&& node server.cjs"
timeout /t 4 /nobreak >nul

echo Clearing Vite cache...
if exist "%~dp0node_modules\.vite" rmdir /s /q "%~dp0node_modules\.vite" 2>nul

echo Starting Vite on 0.0.0.0:5173...
start "GFASORCL-Web" cmd /k "cd /d %~dp0 && npm.cmd run dev -- --host 0.0.0.0 --port 5173"
timeout /t 4 /nobreak >nul

echo Starting Cloudflare tunnel...
start "GFASORCL-Tunnel" cmd /k "cd /d %~dp0 && "%CLOUDFLARED_EXE%" tunnel --config config.yml run"

echo.
echo Open in browser: https://demo.fasaccountingsoftware.in/api/health
echo Console must show: [GFASORCL-5002] and API proxy port 5002
echo If tunnel fails, do NOT use System32 cloudflared — use this script or "start services batch file.bat"
pause
endlocal
