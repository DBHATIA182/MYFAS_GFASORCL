@echo off
REM Run as Administrator (right-click → Run as administrator).
REM The "Cloudflared" Windows service often uses OLD tunnel routes (demo /api → 500).
REM After stopping it, use only "start services batch file.bat" or start-gfasorcl.cmd.

echo Stopping Cloudflared Windows service...
net stop Cloudflared
if errorlevel 1 (
  echo Failed. Right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)

echo Setting service to Manual (does not start at boot)...
sc config Cloudflared start= demand

echo Done. Now run: start services batch file.bat
pause
