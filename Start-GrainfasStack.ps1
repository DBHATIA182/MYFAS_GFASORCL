<#
.SYNOPSIS
  Restart Grainfas (GFASORCL) stack: free ports 5002/5173, then start API + web + tunnel in background.

.PARAMETER AppRoot
  APPTEST folder (default: script directory).

.PARAMETER Ports
  TCP ports to free before start (default 5002, 5173, 5001).

.PARAMETER KillAllCloudflared
  Stops all cloudflared.exe. Default false — other client tunnels on the same PC are left running.

.PARAMETER WaitSeconds
  Seconds to wait after freeing ports (default 3).

.PARAMETER ProductionWeb
  Build once and serve with vite preview (recommended for phone / tunnel). Default on.
#>
[CmdletBinding()]
param(
    [string]$AppRoot = '',
    # Do not free 5001 — Windal on the same PC uses API :5001.
    [int[]]$Ports = @(5002, 5173),
    [switch]$KillAllCloudflared,
    [int]$WaitSeconds = 3,
    [switch]$ProductionWeb = $true
)

$ErrorActionPreference = 'Continue'

function Get-NormalizedAppRoot {
    param(
        [string]$Path,
        [string]$Fallback
    )
    $p = [string]$Path
    if ([string]::IsNullOrWhiteSpace($p)) {
        $p = $Fallback
    }
    $p = $p.Trim().Trim('"').Trim("'")
    while ($p.Length -gt 3 -and ($p.EndsWith('\') -or $p.EndsWith('/'))) {
        $p = $p.Substring(0, $p.Length - 1)
    }
    if (-not (Test-Path -LiteralPath $p)) {
        throw "App folder not found: '$p' (check -AppRoot; avoid trailing backslash inside quotes from .cmd)"
    }
    return (Resolve-Path -LiteralPath $p).Path
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Get-NormalizedAppRoot -Path $AppRoot -Fallback $scriptDir

$logsDir = Join-Path $AppRoot 'logs'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -Path $logsDir -ItemType Directory -Force | Out-Null
}
$bootProbe = Join-Path $logsDir 'autostart-bootstrap.log'
try {
    Add-Content -LiteralPath $bootProbe -Value ('[{0}] Start-GrainfasStack.ps1 started USER={1} COMPUTER={2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $env:USERNAME, $env:COMPUTERNAME) -Encoding UTF8
} catch {
    # ignore probe write errors
}

$stackLog = Join-Path $logsDir 'grainfas-stack.log'
function Write-StackLog([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -LiteralPath $stackLog -Value $line -Encoding UTF8
    Write-Host $line
}

function Add-ToolPaths {
    $extra = @(
        ${env:ProgramFiles} + '\Cloudflared',
        ${env:ProgramFiles(x86)} + '\Cloudflared',
        ${env:ProgramFiles} + '\cloudflared',
        ${env:ProgramFiles(x86)} + '\cloudflared',
        ${env:ProgramFiles} + '\nodejs',
        $env:LOCALAPPDATA + '\Programs\nodejs'
    )
    foreach ($p in $extra) {
        if ((Test-Path -LiteralPath $p) -and ($env:Path -notlike "*$p*")) {
            $env:Path = "$p;$env:Path"
        }
    }
}

function Test-PortListening([int]$port) {
    foreach ($c in Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        if ($c.OwningProcess -gt 4) { return $true }
    }
    foreach ($line in netstat -ano 2>$null) {
        if ($line -match ":$port\s+.*LISTENING") { return $true }
    }
    return $false
}

function Resolve-ToolExe {
    param([string]$Name)
    $map = @{
        'node.exe' = @(
            (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
        )
        'npm.cmd' = @(
            (Join-Path $env:ProgramFiles 'nodejs\npm.cmd'),
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\npm.cmd')
        )
        'cloudflared.exe' = @(
            (Join-Path $env:ProgramFiles 'Cloudflared\cloudflared.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Cloudflared\cloudflared.exe'),
            (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
            (Join-Path $AppRoot 'cloudflared.exe')
        )
    }
    foreach ($p in $map[$Name]) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        $src = [string]$cmd.Source
        # Avoid Windows System32 stub (invalid Win32 application)
        if ($src -and ($src -notmatch '\\System32\\|\\SysWOW64\\')) {
            return $src
        }
    }
    return $null
}

function Get-ClientHostLabel {
    $cfgPath = Join-Path $AppRoot 'connection.config.json'
    if (-not (Test-Path -LiteralPath $cfgPath)) { return 'rbak.fasaccountingsoftware.in' }
    try {
        $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $key = ''
        if ($cfg.PSObject.Properties.Name -contains 'clientName') { $key = [string]$cfg.clientName }
        if ([string]::IsNullOrWhiteSpace($key) -and ($cfg.PSObject.Properties.Name -contains 'defaultClientKey')) {
            $key = [string]$cfg.defaultClientKey
        }
        $key = $key.Trim().ToLower()
        if (-not $key) { $key = 'rbak' }
        $domain = 'fasaccountingsoftware.in'
        if ($cfg.domain -and ($cfg.domain.PSObject.Properties.Name -contains 'rootDomain')) {
            $d = [string]$cfg.domain.rootDomain
            if (-not [string]::IsNullOrWhiteSpace($d)) { $domain = $d.Trim() }
        }
        return "$key.$domain"
    } catch {
        return 'rbak.fasaccountingsoftware.in'
    }
}

function Start-HiddenCmdJob {
    param(
        [string]$Name,
        [string]$CmdLine,
        [string]$LogFile
    )
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $banner = "echo. & echo === $Name started $stamp === & echo."
    $full = "cd /d `"$AppRoot`" & $banner & $CmdLine >> `"$LogFile`" 2>&1"
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $full) -WorkingDirectory $AppRoot -WindowStyle Hidden -PassThru
    Write-StackLog "$Name started (PID $($p.Id)) -> $LogFile"
}

Add-ToolPaths
Write-StackLog "=== Grainfas stack restart === AppRoot=$AppRoot"

$freeScript = Join-Path $AppRoot 'free-grainfas-stack-ports.ps1'
if (-not (Test-Path -LiteralPath $freeScript)) {
    throw "Missing $freeScript"
}

# Also stop prior GFASORCL/Grainfas processes for this folder when available
$stopScript = Join-Path $AppRoot 'stop-apptest-services.ps1'
if (Test-Path -LiteralPath $stopScript) {
    Write-StackLog 'Stopping existing APPTEST processes for this folder'
    # Call in-process so -ReleasePorts @(…) binds as int[]; -File + "5002,5173" becomes "50025173".
    & $stopScript -AppRoot $AppRoot -ReleasePorts @(5002, 5173) -WaitSeconds 1 2>&1 |
        ForEach-Object { Write-StackLog $_ }
}

Write-StackLog "Freeing ports: $($Ports -join ', ')"
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $freeScript -Ports $Ports 2>&1 | ForEach-Object { Write-StackLog $_ }

if ($KillAllCloudflared) {
    Write-StackLog 'Stopping all cloudflared.exe'
    & $env:SystemRoot\System32\taskkill.exe /F /IM cloudflared.exe 2>&1 | ForEach-Object { Write-StackLog $_ }
} else {
    # Stop only cloudflared using this app's config.yml
    $configYmlProbe = Join-Path $AppRoot 'config.yml'
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'cloudflared.exe' -and
            $_.CommandLine -and
            ($_.CommandLine -like "*$AppRoot*" -or $_.CommandLine -like "*$configYmlProbe*")
        } |
        ForEach-Object {
            Write-StackLog "Stopping app cloudflared PID $($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

if ($WaitSeconds -gt 0) {
    Start-Sleep -Seconds $WaitSeconds
}

foreach ($port in $Ports) {
    if (Test-PortListening $port) {
        Write-StackLog "Port $port still in use - freeing again"
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $freeScript -Ports @($port) 2>&1 | ForEach-Object { Write-StackLog $_ }
        Start-Sleep -Seconds 2
        if (Test-PortListening $port) {
            Write-StackLog "ERROR: port $port still LISTENING - stop the process manually or reboot"
        } else {
            Write-StackLog "Port $port is now free."
        }
    } else {
        Write-StackLog "Port $port is free."
    }
}

$nodeExe = Resolve-ToolExe 'node.exe'
$npmCmd = Resolve-ToolExe 'npm.cmd'
if (-not $nodeExe) {
    Write-StackLog 'ERROR: node.exe not found. Install Node.js LTS to Program Files\nodejs'
    exit 1
}
if (-not $npmCmd) {
    Write-StackLog 'ERROR: npm.cmd not found.'
    exit 1
}
Write-StackLog "Using node: $nodeExe"

# Clear Vite cache so stale modules do not stick after restart
$viteCache = Join-Path $AppRoot 'node_modules\.vite'
if (Test-Path -LiteralPath $viteCache) {
    Write-StackLog 'Clearing node_modules\.vite cache'
    Remove-Item -LiteralPath $viteCache -Recurse -Force -ErrorAction SilentlyContinue
}

$serverLog = Join-Path $logsDir 'server.log'
$frontendLog = Join-Path $logsDir 'frontend.log'
$tunnelLog = Join-Path $logsDir 'tunnel.log'

$nodeQ = '"' + $nodeExe + '"'
$npmQ = '"' + $npmCmd + '"'
Start-HiddenCmdJob -Name 'Grainfas-API' -CmdLine "set PORT=5002&& $nodeQ server.cjs" -LogFile $serverLog
Start-Sleep -Seconds 2

if ($ProductionWeb) {
    Write-StackLog 'ProductionWeb: npm run build (for mobile / tunnel)'
    $buildLog = Join-Path $logsDir 'frontend-build.log'
    $buildCmd = "cd /d `"$AppRoot`" & $npmQ run build >> `"$buildLog`" 2>&1"
    $bp = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $buildCmd) -WorkingDirectory $AppRoot -WindowStyle Hidden -Wait -PassThru
    if ($bp.ExitCode -ne 0) {
        Write-StackLog "ERROR: npm run build failed (exit $($bp.ExitCode)). See $buildLog"
        exit $bp.ExitCode
    }
    Write-StackLog 'ProductionWeb: starting vite preview on 5173'
    Start-HiddenCmdJob -Name 'Grainfas-Preview' -CmdLine "$npmQ run preview -- --host 0.0.0.0 --port 5173 --strictPort" -LogFile $frontendLog
} else {
    Write-StackLog 'Starting Vite DEV on port 5173'
    Start-HiddenCmdJob -Name 'Grainfas-Vite' -CmdLine "$npmQ run dev -- --host 0.0.0.0 --port 5173 --strictPort" -LogFile $frontendLog
}
Start-Sleep -Seconds 8

try {
    $probe = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 15
    $body = [string]$probe.Content
    if ($ProductionWeb) {
        if ($body -match '/SRC/main\.jsx|/@vite/client') {
            Write-StackLog 'ERROR: Port 5173 is still Vite DEV. Stop npm run dev on 5173, then run this script again.'
        } elseif ($body -match '/assets/index-[^"]+\.js') {
            Write-StackLog 'OK: Port 5173 is production preview (/assets/ bundle).'
        } else {
            Write-StackLog 'WARNING: Port 5173 responded but HTML format unexpected. Check logs\frontend.log'
        }
    } else {
        Write-StackLog 'OK: Port 5173 responded (Vite DEV).'
    }
} catch {
    Write-StackLog "WARNING: Could not probe http://127.0.0.1:5173/ - $($_.Exception.Message)"
}

Start-Sleep -Seconds 1

$configYml = Join-Path $AppRoot 'config.yml'
$cfExe = Resolve-ToolExe 'cloudflared.exe'
if ((Test-Path -LiteralPath $configYml) -and $cfExe) {
    Write-StackLog "Using cloudflared: $cfExe"
    $cfQ = '"' + $cfExe + '"'
    Start-HiddenCmdJob -Name 'Grainfas-Tunnel' -CmdLine "$cfQ tunnel --config `"$configYml`" run" -LogFile $tunnelLog
} elseif (-not (Test-Path -LiteralPath $configYml)) {
    Write-StackLog 'WARNING: config.yml missing - tunnel not started'
} else {
    Write-StackLog 'WARNING: cloudflared.exe not found - tunnel not started'
}

$hostLabel = Get-ClientHostLabel
Write-StackLog "Done. No taskbar windows (background). Check logs\server.log / logs\frontend.log / logs\tunnel.log"
Write-StackLog "Phone/PC URL: https://$hostLabel/"
Write-StackLog "Health: https://$hostLabel/api/health"
