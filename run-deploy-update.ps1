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

function Stop-AppProcesses {
    Log 'Stopping app-related processes...'
    try {
        $likeRoot = '*' + $AppRoot + '*'
        $targets = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CommandLine -and
                ($_.CommandLine -like $likeRoot) -and
                ($_.Name -in @('node.exe', 'esbuild.exe', 'cloudflared.exe'))
            }
        foreach ($p in $targets) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                Log ("Stopped by path/name filter: " + $p.Name + " PID " + $p.ProcessId)
            } catch {
                Log ("Could not stop PID " + $p.ProcessId + ": " + $_.Exception.Message)
            }
        }
    } catch {
        Log ("WARN path-based stop failed: " + $_.Exception.Message)
    }

    try {
        Get-Process node, esbuild, cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                Stop-Process -Id $_.Id -Force -ErrorAction Stop
                Log ("Stopped by process-name filter: " + $_.ProcessName + " PID " + $_.Id)
            } catch {
                Log ("Could not stop " + $_.ProcessName + " PID " + $_.Id + ": " + $_.Exception.Message)
            }
        }
    } catch {
        Log ("WARN process-name stop failed: " + $_.Exception.Message)
    }
}

try {
    Stop-AppProcesses
    Start-Sleep -Seconds 1

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

Stop-AppProcesses

Start-Sleep -Seconds 2

try {
    $psLauncher = Join-Path $AppRoot 'start-apptest-services.ps1'
    $cmdLauncher = Join-Path $AppRoot 'run-autostart-stack.cmd'
    if (Test-Path -LiteralPath $psLauncher) {
        Log 'Starting start-apptest-services.ps1...'
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$psLauncher`"", '-AppRoot', "`"$AppRoot`"") -WorkingDirectory $AppRoot -WindowStyle Minimized
        Log 'start-apptest-services.ps1 started.'
    } elseif (Test-Path -LiteralPath $cmdLauncher) {
        Log 'Starting run-autostart-stack.cmd...'
        Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "`"$cmdLauncher`"") -WorkingDirectory $AppRoot -WindowStyle Minimized
        Log 'run-autostart-stack.cmd started.'
    } else {
        Log 'WARN: Neither start-apptest-services.ps1 nor run-autostart-stack.cmd found — start services manually.'
    }
} catch {
    Log ("ERROR starting launcher: " + $_.Exception.Message)
    exit 1
}

Log '--- deploy update finished ---'
exit 0
