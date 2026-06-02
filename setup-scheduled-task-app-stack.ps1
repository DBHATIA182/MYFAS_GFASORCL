<#
.SYNOPSIS
  Registers GFASORCL to start API + Vite + tunnel automatically.

.PARAMETER RunAtLogon
  Start when you sign in to Windows (DEFAULT - recommended on dev PC).

.PARAMETER AtStartup
  Start at boot as SYSTEM (+ delay). Use on servers that must run without login.

.PARAMETER StartupDelayMinutes
  Delay after trigger (default 1 for logon, 3 for startup).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-scheduled-task-app-stack.ps1 -RunAtLogon
#>
[CmdletBinding()]
param(
    [string]$AppRoot = '',
    [string]$TaskName = '',
    [int]$StartupDelayMinutes = -1,
    [switch]$RunAtLogon,
    [switch]$AtStartup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    throw @'
Access denied. Scheduled tasks require Administrator.

Right-click setup-gfasorcl-autostart.cmd and choose "Run as administrator".
'@
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = $scriptDir
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path

$launcher = Join-Path $AppRoot 'run-autostart-stack.cmd'
if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Missing launcher: $launcher"
}
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'server.cjs'))) {
    throw "Missing server.cjs at $AppRoot"
}

$configPath = Join-Path $AppRoot 'connection.config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Missing $configPath"
}

if ([string]::IsNullOrWhiteSpace($TaskName)) {
    $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $client = $cfg.clientName
    if ([string]::IsNullOrWhiteSpace($client)) { $client = $cfg.defaultClientKey }
    if ([string]::IsNullOrWhiteSpace($client)) {
        throw 'Set clientName in connection.config.json or pass -TaskName'
    }
    $TaskName = "GFAS-$client-AppStack"
}

$useLogon = $true
if ($AtStartup) { $useLogon = $false }
if ($RunAtLogon) { $useLogon = $true }

if ($StartupDelayMinutes -lt 0) {
    $StartupDelayMinutes = if ($useLogon) { 1 } else { 3 }
}

$logsDir = Join-Path $AppRoot 'logs'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -Path $logsDir -ItemType Directory -Force | Out-Null
}

Get-ScheduledTask -TaskPath '\' -ErrorAction SilentlyContinue |
    Where-Object {
        $_.TaskName -ne $TaskName -and (
            $_.TaskName -like 'GFAS-*-API' -or $_.TaskName -like 'GFAS-*-AllServices'
        )
    } |
    ForEach-Object {
        Write-Host "Disabling old task: $($_.TaskName)" -ForegroundColor Yellow
        Disable-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue | Out-Null
    }

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ("/c `"$launcher`"") -WorkingDirectory $AppRoot

if ($useLogon) {
    $user = $env:USERNAME
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    if ($StartupDelayMinutes -gt 0) {
        $trigger.Delay = ('PT{0}M' -f $StartupDelayMinutes)
    }
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
    $desc = "GFASORCL stack at logon for $user"
    Write-Host "Mode: At logon for $user (delay $StartupDelayMinutes min) - RECOMMENDED" -ForegroundColor Green
} else {
    $trigger = New-ScheduledTaskTrigger -AtStartup
    if ($StartupDelayMinutes -gt 0) {
        $trigger.Delay = ('PT{0}M' -f $StartupDelayMinutes)
    }
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $desc = ('GFASORCL stack at startup (+{0} min delay) as SYSTEM' -f $StartupDelayMinutes)
    Write-Host "Mode: At system startup as SYSTEM (delay $StartupDelayMinutes min)" -ForegroundColor Cyan
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $desc -Force | Out-Null

Write-Host ''
Write-Host "Task created: $TaskName" -ForegroundColor Green
Write-Host "Launcher: $launcher" -ForegroundColor Green
Write-Host "Logs: $logsDir" -ForegroundColor Green
Write-Host ''
Write-Host 'Test now (Admin):' -ForegroundColor Yellow
Write-Host ('  schtasks /Run /TN "{0}"' -f $TaskName)
Write-Host '  Wait 90 sec, then check API http://localhost:5002 and UI http://localhost:5173'
Write-Host ''
Write-Host 'Disable conflicting tasks if any:' -ForegroundColor Yellow
Write-Host '  GFAS-*-API, GFAS-*-AllServices' -ForegroundColor DarkYellow
