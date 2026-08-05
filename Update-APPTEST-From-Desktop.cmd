@echo off
setlocal EnableExtensions EnableDelayedExpansion
title APPTEST One-Click Update

REM APP_ROOT = this .cmd file's folder (D:\GFASORCL\APPTEST, E:\..., etc.).
REM Optional override example: set "APP_ROOT=D:\GFASORCL\APPTEST"
set "APP_ROOT=%~dp0"
set "APP_ROOT=%APP_ROOT:~0,-1%"
set "BRANCH=main"

if not exist "%APP_ROOT%" (
  echo [ERROR] APP_ROOT not found: "%APP_ROOT%"
  echo Edit APP_ROOT in this file and try again.
  pause
  exit /b 1
)

cd /d "%APP_ROOT%"
if not exist logs mkdir logs

set "STAMP=%DATE% %TIME%"
set "LOG_FILE=%APP_ROOT%\logs\desktop-update.log"
echo.>> "%LOG_FILE%"
echo ============================================================>> "%LOG_FILE%"
echo [%STAMP%] Desktop updater started.>> "%LOG_FILE%"
echo APP_ROOT=%APP_ROOT% BRANCH=%BRANCH%>> "%LOG_FILE%"

echo.
echo [1/3] Stopping APPTEST services...
echo [1/3] Stopping APPTEST services...>> "%LOG_FILE%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%\stop-apptest-services.ps1" -AppRoot "%APP_ROOT%" -ReleaseApiPort5001 -ReleasePorts 5002,5173 >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] stop-apptest-services failed. Check "%LOG_FILE%"
  echo [ERROR] stop-apptest-services failed.>> "%LOG_FILE%"
  pause
  exit /b 1
)

echo.
echo [2/3] Updating from Git and rebuilding...
echo [2/3] Updating from Git and rebuilding...>> "%LOG_FILE%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%\update-from-git.ps1" -Branch "%BRANCH%" -AppRoot "%APP_ROOT%" -SkipProcessStop >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] update-from-git failed. Check "%LOG_FILE%"
  echo [ERROR] update-from-git failed.>> "%LOG_FILE%"
  pause
  exit /b 1
)

echo.
echo [3/3] Starting APPTEST services...
echo [3/3] Starting APPTEST services...>> "%LOG_FILE%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%\start-apptest-services.ps1" -AppRoot "%APP_ROOT%" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] start-apptest-services failed. Check "%LOG_FILE%"
  echo [ERROR] start-apptest-services failed.>> "%LOG_FILE%"
  pause
  exit /b 1
)

echo.
echo [DONE] Update complete.
echo [DONE] Update complete.>> "%LOG_FILE%"
echo Log file: "%LOG_FILE%"
echo [%DATE% %TIME%] Desktop updater finished OK.>> "%LOG_FILE%"
pause
exit /b 0
