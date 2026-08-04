<#
  Builds docs\CLIENT_DEPLOYMENT_GUIDE.pdf from docs\CLIENT_DEPLOYMENT_GUIDE.html using Edge headless.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$html = Join-Path $root "docs\CLIENT_DEPLOYMENT_GUIDE.html"
$pdf = Join-Path $root "docs\CLIENT_DEPLOYMENT_GUIDE.pdf"
if (-not (Test-Path -LiteralPath $html)) {
    throw "Missing: $html"
}
$edgeCandidates = @(
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) {
    throw "Microsoft Edge (msedge.exe) not found. Open CLIENT_DEPLOYMENT_GUIDE.html in a browser and use Print -> Save as PDF."
}
$fileUrl = "file:///" + ($html -replace "\\", "/")
if (Test-Path -LiteralPath $pdf) { Remove-Item -LiteralPath $pdf -Force }
& $edge --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$pdf" $fileUrl
$deadline = (Get-Date).AddSeconds(20)
do {
    Start-Sleep -Milliseconds 500
    if ((Test-Path -LiteralPath $pdf) -and ((Get-Item -LiteralPath $pdf).Length -gt 1000)) { break }
} while ((Get-Date) -lt $deadline)
if (-not (Test-Path -LiteralPath $pdf) -or ((Get-Item -LiteralPath $pdf).Length -lt 1000)) {
    throw "PDF was not created. Try opening the HTML and Print to PDF manually."
}
Write-Host "Wrote: $pdf" -ForegroundColor Green
Get-Item -LiteralPath $pdf | Select-Object FullName, Length, LastWriteTime
