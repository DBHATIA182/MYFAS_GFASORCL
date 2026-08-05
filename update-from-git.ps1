<#
.SYNOPSIS
  Pull latest code from Git, install exact dependencies (npm ci), rebuild UI.

.PARAMETER Branch
  Git branch to checkout and pull (default: main).

.PARAMETER AppRoot
  App folder (default: script directory).

.PARAMETER SkipProcessStop
  Skip stop-apptest-services.ps1 (caller already stopped services).

.EXAMPLE
  .\update-from-git.ps1
  .\update-from-git.ps1 -Branch main
#>
[CmdletBinding()]
param(
    [string]$Branch = 'main',
    [string]$AppRoot = '',
    [switch]$SkipProcessStop
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
Set-Location -LiteralPath $AppRoot

function Ensure-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required command '$name' is not in PATH. Install it and retry."
    }
}

function Invoke-Npm([string[]]$npmArgs) {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCmd) {
        & $npmCmd.Source @npmArgs
    } else {
        & npm @npmArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($npmArgs -join ' ') failed (exit $LASTEXITCODE)."
    }
}

function Stop-AppNodeLocks {
    Write-Host '==> Releasing Node locks (stops node.exe so oracledb .node can be replaced)...' -ForegroundColor Cyan

    # Kill every node whose command line mentions this app (any path casing).
    $rootNorm = $AppRoot.TrimEnd('\').ToLowerInvariant()
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'node.exe' -and
            $_.CommandLine -and
            $_.CommandLine.ToLowerInvariant().Contains($rootNorm)
        }
    foreach ($p in @($procs)) {
        try {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            Write-Host ("Stopped app node.exe (PID {0})" -f $p.ProcessId) -ForegroundColor Green
        } catch {
            Write-Host ("Could not stop node.exe PID {0}: {1}" -f $p.ProcessId, $_.Exception.Message) -ForegroundColor Yellow
        }
    }

    foreach ($port in @(5002, 5173, 5001)) {
        try {
            Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique |
                ForEach-Object {
                    $owningPid = [int]$_
                    if ($owningPid -le 4) { return }
                    $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
                    if ($proc -and $proc.ProcessName -eq 'node') {
                        Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
                        Write-Host ("Stopped node.exe on port {0} (PID {1})" -f $port, $owningPid) -ForegroundColor Green
                    }
                }
        } catch { }
    }

    # Last resort for locked oracledb native binary: stop ALL node.exe on this PC.
    $anyNode = @(Get-Process -Name node -ErrorAction SilentlyContinue)
    if ($anyNode.Count -gt 0) {
        Write-Host ("==> Stopping all remaining node.exe ({0}) for clean npm ci..." -f $anyNode.Count) -ForegroundColor Yellow
        foreach ($p in $anyNode) {
            try {
                Stop-Process -Id $p.Id -Force -ErrorAction Stop
                Write-Host ("Stopped node.exe (PID {0})" -f $p.Id) -ForegroundColor Green
            } catch {
                Write-Host ("Could not stop node.exe PID {0}: {1}" -f $p.Id, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    }

    Start-Sleep -Seconds 3
}

function Clear-NodeModulesForInstall {
    $nm = Join-Path $AppRoot 'node_modules'
    if (-not (Test-Path -LiteralPath $nm)) { return }
    Write-Host '==> Removing node_modules before npm ci...' -ForegroundColor Yellow
    $stamp = Get-Date -Format 'yyyyMMddHHmmss'
    $trash = Join-Path $AppRoot ("node_modules.__trash_$stamp")
    try {
        Move-Item -LiteralPath $nm -Destination $trash -Force -ErrorAction Stop
        Start-Job -ScriptBlock {
            param($path)
            Start-Sleep -Seconds 1
            cmd.exe /c "rd /s /q `"$path`"" | Out-Null
            if (Test-Path -LiteralPath $path) {
                Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
            }
        } -ArgumentList $trash | Out-Null
        return
    } catch {
        Write-Host ("Move failed ({0}); trying rd /s /q..." -f $_.Exception.Message) -ForegroundColor Yellow
    }

    cmd.exe /c "rd /s /q `"$nm`"" | Out-Null
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $nm) {
        Remove-Item -LiteralPath $nm -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $nm) {
        throw @'
Could not remove node_modules (file locked — usually oracledb .node).

Close all GRAINFAS / Cursor terminals using this folder, then run:
  taskkill /F /IM node.exe /T
  rd /s /q node_modules
  npm ci
  npm run build
  .\grainfas_start_Services.bat
'@
    }
}

if (-not $SkipProcessStop) {
    $stopScript = Join-Path $AppRoot 'stop-apptest-services.ps1'
    if (Test-Path -LiteralPath $stopScript) {
        Write-Host ''
        Write-Host '==> Ensuring no GFASORCL processes lock files...' -ForegroundColor Cyan
        & $stopScript -AppRoot $AppRoot -ReleaseApiPort5001 -ReleasePorts '5002,5173' -WaitSeconds 2
    }
}

Write-Host ''
Write-Host "==> GFASORCL update-from-git ($Branch)" -ForegroundColor Cyan
Write-Host "    Folder: $AppRoot"

Ensure-Command 'git'

if (-not (Test-Path -LiteralPath (Join-Path $AppRoot '.git'))) {
    throw @'
This folder is not a Git repository (.git missing).

One-time fix on this PC:
  1. Rename or move the current folder (backup)
  2. git clone <YOUR_REPO_URL> E:\GFASORCL\APPTEST
  3. Copy back ONLY client-specific files (connection.config.json, config.yml, tunnel creds)
  4. npm ci && npm run build
'@
}

git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }

git checkout $Branch
if ($LASTEXITCODE -ne 0) { throw "git checkout $Branch failed." }

# Client PCs often have leftover copy files / local edits that block `git pull`.
# Match GitHub exactly for tracked files. Ignored client files stay
# (connection.config.json, config.yml, tunnel UUID.json, node_modules, etc.).
Write-Host '==> Syncing tracked files to origin/' -NoNewline -ForegroundColor Cyan
Write-Host $Branch -ForegroundColor Cyan

git reset --hard "origin/$Branch"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'reset blocked; removing untracked files that conflict (keeps gitignored client config)...' -ForegroundColor Yellow
    git clean -fd -e "public/invoices" -e "logs"
    if ($LASTEXITCODE -ne 0) { throw 'git clean failed.' }
    git reset --hard "origin/$Branch"
    if ($LASTEXITCODE -ne 0) { throw 'git reset --hard failed after clean.' }
}

# Drop untracked copies that are not ignored (e.g. docs pasted beside a clone).
# Keep runtime invoice PDFs and logs. Ignored client config is never cleaned.
git clean -fd -e "public/invoices" -e "logs" -e "APPTEST.rar"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Warning: git clean reported an error; continuing.' -ForegroundColor Yellow
}

# VFP reference trees are master/dev only — never keep them on client installs.
$vfpSkipDirs = @('vfp', 'VFP', 'VFP-EXPORT', 'VFP-IMPORT', 'vfp-export', 'vfp-import')
$removedVfp = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($name in $vfpSkipDirs) {
    $dir = Join-Path $AppRoot $name
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $resolved = (Resolve-Path -LiteralPath $dir).Path
    if (-not $removedVfp.Add($resolved)) { continue }
    Write-Host "==> Removing client-unneeded folder: $name" -ForegroundColor Yellow
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
}

Write-Host ''
Write-Host '==> Preparing clean npm install...' -ForegroundColor Cyan
Stop-AppNodeLocks
Clear-NodeModulesForInstall

Write-Host ''
Write-Host '==> npm ci' -ForegroundColor Cyan
Invoke-Npm @('ci')

Write-Host ''
Write-Host '==> npm run build' -ForegroundColor Cyan
Invoke-Npm @('run', 'build')

Write-Host ''
Write-Host 'Done. Restart API + Vite + tunnel if not started automatically.' -ForegroundColor Green
exit 0
