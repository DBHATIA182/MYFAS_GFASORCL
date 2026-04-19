@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
REM Node may not be on PATH in new shells until logoff; match run-all-services.cmd
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
echo [%date% %time%] Starting API server...>> logs\server.log
npm.cmd run server >> logs\server.log 2>&1
