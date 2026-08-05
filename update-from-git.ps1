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

if (-not $SkipProcessStop) {
    $stopScript = Join-Path $AppRoot 'stop-apptest-services.ps1'
    if (Test-Path -LiteralPath $stopScript) {
        Write-Host ''
        Write-Host '==> Ensuring no GFASORCL processes lock files...' -ForegroundColor Cyan
        & $stopScript -AppRoot $AppRoot -ReleaseApiPort5001 -WaitSeconds 2
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
    git clean -fd
    if ($LASTEXITCODE -ne 0) { throw 'git clean failed.' }
    git reset --hard "origin/$Branch"
    if ($LASTEXITCODE -ne 0) { throw 'git reset --hard failed after clean.' }
}

# Drop untracked copies that are not ignored (e.g. docs pasted beside a clone).
# Does NOT delete ignored files: connection.config.json, config.yml, tunnel creds, node_modules.
git clean -fd
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
Write-Host '==> npm ci' -ForegroundColor Cyan
Invoke-Npm @('ci')

Write-Host ''
Write-Host '==> npm run build' -ForegroundColor Cyan
Invoke-Npm @('run', 'build')

Write-Host ''
Write-Host 'Done. Restart API + Vite + tunnel if not started automatically.' -ForegroundColor Green
exit 0
