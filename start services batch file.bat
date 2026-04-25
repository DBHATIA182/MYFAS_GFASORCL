@echo off

REM Terminal 1 - Node server
start "Server" /min cmd /k "E: && cd \GFASORCL\APPTEST && node server.cjs"

REM Terminal 2 - Vite/Dev server
start "Dev" /min cmd /k "E: && cd \GFASORCL\APPTEST && npm run dev --host"

REM Terminal 3 - Cloudflared
start "Tunnel" /min cmd /k "E: && cd \GFASORCL\APPTEST && cloudflared tunnel --config .\config.yml run"