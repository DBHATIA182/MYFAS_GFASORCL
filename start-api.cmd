@echo off
cd /d "%~dp0"
set PORT=5002
echo GFASORCL API on port %PORT%
node server.cjs
