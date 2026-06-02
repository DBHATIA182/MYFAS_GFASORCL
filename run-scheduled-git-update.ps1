<#
.SYNOPSIS
  Automatic GFASORCL client update: stop all services, git pull + build, restart stack.

.DESCRIPTION
  Logs to logs\git-auto-update.log
#>
[CmdletBinding()]
param(
    [string]$AppRoot = '',
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = $scriptDir
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path

$logDir = Join-Path $AppRoot 'logs'
if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -Path $logDir -ItemType Directory -Force | Out-Null
}
$logFile = Join-Path $logDir 'git-auto-update.log'

function Write-Log([string]$msg, [string]$level = 'INFO') {
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $level, $msg
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

function Stop-PortListeners([int[]]$Ports) {
    foreach ($port in $Ports) {
        try {
            $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                ForEach-Object { $_.OwningProcess } | Sort-Object -Unique | Where-Object { $_ -and $_ -gt 4 })
            if ($pids.Count -eq 0) {
                Write-Log "No LISTEN process on port $port."
                continue
            }
            foreach ($procId in $pids) {
                $wp = Get-CimInstance Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
                if (-not $wp) { continue }
                if ($wp.Name -ne 'node.exe') {
                    Write-Log "Port ${port}: PID $procId is $($wp.Name) - not stopped automatically." 'WARN'
                    continue
                }
                Stop-Process -Id $procId -Force -ErrorAction Stop
                Write-Log "Stopped node.exe on port $port (PID $procId)." 'OK'
            }
        } catch {
            Write-Log "Port $port check failed: $($_.Exception.Message)" 'WARN'
        }
    }
}

Write-Log '============================================================'
Write-Log "Scheduled git update started (task: git_dal_update). AppRoot=$AppRoot Branch=$Branch USER=$env:USERNAME"
Write-Log 'Flow: STOP all services -> git pull + build -> RESTART services'

try {
    Set-Location -LiteralPath $AppRoot

    Write-Log 'Step 1/3: Stopping GFASORCL services...'
    $stopScript = Join-Path $AppRoot 'stop-apptest-services.ps1'
    if (-not (Test-Path -LiteralPath $stopScript)) {
        throw "Missing $stopScript"
    }
    & $stopScript -AppRoot $AppRoot -StopScheduledTasks -ReleaseApiPort5001 -WaitSeconds 5
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
        throw "stop-apptest-services.ps1 failed with exit code $LASTEXITCODE"
    }
    Stop-PortListeners -Ports @(5002, 5173)
    Write-Log 'All services stopped.' 'OK'

    Write-Log 'Step 2/3: Git pull and rebuild (services remain stopped)...'
    $updateScript = Join-Path $AppRoot 'update-from-git.ps1'
    if (-not (Test-Path -LiteralPath $updateScript)) {
        throw "Missing $updateScript"
    }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $updateScript -Branch $Branch -AppRoot $AppRoot -SkipProcessStop
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
        throw "update-from-git.ps1 failed with exit code $LASTEXITCODE"
    }
    Write-Log 'Git pull and build finished.' 'OK'

    Write-Log 'Step 3/3: Restarting GFASORCL services...'
    $startScript = Join-Path $AppRoot 'start-apptest-services.ps1'
    if (-not (Test-Path -LiteralPath $startScript)) {
        throw "Missing $startScript"
    }
    & $startScript -AppRoot $AppRoot
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
        throw "start-apptest-services.ps1 failed with exit code $LASTEXITCODE"
    }
    Write-Log 'Services restarted.' 'OK'

    Write-Log 'Scheduled git update completed successfully.' 'OK'
    exit 0
} catch {
    Write-Log $_.Exception.Message 'ERROR'
    if ($_.ScriptStackTrace) {
        Write-Log $_.ScriptStackTrace 'ERROR'
    }
    Write-Log 'Scheduled git update FAILED. Run start-apptest-services.ps1 or setup-gfasorcl-autostart task manually.' 'ERROR'
    exit 1
}
