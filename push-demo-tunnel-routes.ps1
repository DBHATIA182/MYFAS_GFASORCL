# Push demo tunnel ingress to Cloudflare (fixes /api/health HTTP 500 on demo URL).
# Requires: Cloudflare API token with "Cloudflare Tunnel" Edit + Account ID.
#
# Usage:
#   $env:CLOUDFLARE_API_TOKEN = "your-token"
#   $env:CLOUDFLARE_ACCOUNT_ID = "your-account-id"
#   .\push-demo-tunnel-routes.ps1
#
# Or run push-demo-tunnel-routes.cmd and paste values when prompted.

param(
  [string]$AccountId = $env:CLOUDFLARE_ACCOUNT_ID,
  [string]$ApiToken = $env:CLOUDFLARE_API_TOKEN,
  [string]$TunnelId = "1f7d513b-066e-4d0c-bc0f-7718109dad24"
)

$ErrorActionPreference = "Stop"

if (-not $AccountId) {
  $AccountId = Read-Host "Cloudflare Account ID (Zero Trust home URL or Overview sidebar)"
}
if (-not $ApiToken) {
  $secure = Read-Host "Cloudflare API Token" -AsSecureString
  $ApiToken = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}

# Use 127.0.0.1 not localhost (Windows + cloudflared often fails on localhost → 502/500).
$ingress = @(
  @{
    hostname = "demo.fasaccountingsoftware.in"
    path     = "/api/*"
    service  = "http://127.0.0.1:5002"
  },
  @{
    hostname = "demo.fasaccountingsoftware.in"
    service  = "http://127.0.0.1:5173"
  },
  @{
    hostname = "demo-api.fasaccountingsoftware.in"
    service  = "http://127.0.0.1:5002"
  },
  @{
    service = "http_status:404"
  }
)

$body = @{ config = @{ ingress = $ingress } } | ConvertTo-Json -Depth 6
$uri = "https://api.cloudflare.com/client/v4/accounts/$AccountId/cfd_tunnel/$TunnelId/configurations"

Write-Host "Updating tunnel $TunnelId ..." -ForegroundColor Cyan
Write-Host $body

$response = Invoke-RestMethod -Uri $uri -Method Put -Headers @{
  Authorization = "Bearer $ApiToken"
  "Content-Type" = "application/json"
} -Body $body

if (-not $response.success) {
  $response | ConvertTo-Json -Depth 6 | Write-Host
  throw "Cloudflare API returned success=false. Check token permissions (Tunnel Edit)."
}

Write-Host ""
Write-Host 'OK - tunnel routes updated. Wait 30 seconds, then open:' -ForegroundColor Green
Write-Host '  https://demo.fasaccountingsoftware.in/api/health'
Write-Host 'Expected JSON: {"ok":true,"port":5002}'
Write-Host ''
Write-Host 'Restart ONE cloudflared only: start services batch file.bat' -ForegroundColor Yellow
