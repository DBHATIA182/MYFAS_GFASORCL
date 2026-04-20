<#
  Started by the API (background). Runs git pull + npm ci + build, then stops Node/cloudflared
  for this app and launches run-autostart-stack.cmd again.

  Log: logs\deploy-update.log
#>
$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $AppRoot

$logDir = Join-Path $AppRoot 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir 'deploy-update.log'

function Log([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    Add-Content -LiteralPath $log -Value $line
    Write-Host $line
}

Log '--- deploy update started ---'

try {
    $updateScript = Join-Path $AppRoot 'update-from-git.ps1'
    if (-not (Test-Path -LiteralPath $updateScript)) {
        throw "Missing update-from-git.ps1"
    }
    Log 'Running update-from-git.ps1...'
    $updateOut = & $updateScript 2>&1
    foreach ($line in $updateOut) {
        Log ($line | Out-String).Trim()
    }
    if ($LASTEXITCODE -ne 0) {
        throw "update-from-git.ps1 exited with code $LASTEXITCODE"
    }
    Log 'update-from-git.ps1 finished OK'
} catch {
    Log ("ERROR in update step: " + $_.Exception.Message)
    exit 1
}

try {
    Log 'Stopping Node processes for this app (API + Vite)...'
    $likeRoot = '*' + $AppRoot + '*'
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'node.exe' -and $_.CommandLine -and
            ($_.CommandLine -like $likeRoot) -and
            ($_.CommandLine -match 'server\.cjs' -or $_.CommandLine -match 'vite')
        }
    foreach ($p in $procs) {
        try {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            Log ("Stopped node.exe PID " + $p.ProcessId)
        } catch {
            Log ("Could not stop PID " + $p.ProcessId + ": " + $_.Exception.Message)
        }
    }
} catch {
    Log ("WARN during process stop: " + $_.Exception.Message)
}

Start-Sleep -Seconds 2

try {
    $launcher = Join-Path $AppRoot 'run-autostart-stack.cmd'
    if (Test-Path -LiteralPath $launcher) {
        Log 'Starting run-autostart-stack.cmd...'
        Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$launcher`"") -WorkingDirectory $AppRoot -WindowStyle Minimized
        Log 'Launcher started.'
    } else {
        Log 'WARN: run-autostart-stack.cmd not found — start API + Vite + tunnel manually.'
    }
} catch {
    Log ("ERROR starting launcher: " + $_.Exception.Message)
    exit 1
}

Log '--- deploy update finished ---'
exit 0
