# Builds Ludo Royale: tests, the web client, the Windows app, its installer and a portable zip.
#   powershell -ExecutionPolicy Bypass -File build.ps1                       # everything
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Version 1.0.1
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Server https://ludo-royale.example.workers.dev
#   powershell -ExecutionPolicy Bypass -File build.ps1 -SkipTests            # no tests first
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Integration          # also the server integration tests (starts wrangler dev)
# Output: dist\LudoRoyale-Setup-<version>.exe, dist\LudoRoyale-<version>-portable.zip, dist\SHA256SUMS.txt
#         and the same three files in release\ (the published downloads).
param(
    [string]$Version = "1.0.0",
    # The public game server (the browser version is served there too). The Windows app connects to it
    # and shared links point at it. Keep it in step with the Worker's domain (see README, Deploy).
    [string]$Server = "https://ludo.nomanshafiq.com",
    [switch]$SkipTests,
    [switch]$Integration,
    [switch]$SkipInstaller
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$publish = Join-Path $root "publish\windows"
$dist = Join-Path $root "dist"
$release = Join-Path $root "release"
$project = Join-Path $root "windows\LudoRoyale\LudoRoyale.csproj"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
$env:WRANGLER_SEND_METRICS = 'false'
if ($Server -notmatch '^https://[a-z0-9.-]+(:[0-9]+)?$') { throw "-Server must look like https://host (no path), not '$Server'" }
$env:VITE_SERVER_URL = $Server

function Find-Tool([string[]]$candidates) {
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}
function Run([string]$what, [scriptblock]$block) {
    Write-Host "==> $what" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

# ---- tools ---------------------------------------------------------------------------
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "Node.js (npm) not found. Install Node.js 22 or newer from https://nodejs.org" }
$dotnetCmd = Get-Command dotnet -ErrorAction SilentlyContinue
$dotnet = Find-Tool @("$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe", $(if ($dotnetCmd) { $dotnetCmd.Source }))
if (-not $dotnet) { throw ".NET SDK not found. Install it from https://dot.net (it builds the .NET Framework 4.8 app too)" }
$iscc = Find-Tool @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe")
if (-not $iscc -and -not $SkipInstaller) { throw "Inno Setup 6 not found. Install it from https://jrsoftware.org/isdl.php" }

Push-Location $root
try {
    if (-not (Test-Path (Join-Path $root "node_modules"))) { Run "npm ci" { & $npm ci --no-fund --no-audit } }

    # ---- tests and web client ------------------------------------------------------------
    if (-not $SkipTests) {
        Run "Type checks" { & $npm run typecheck }
        Run "Rules engine, protocol and client tests" { & $npm test }
    }
    Run "Web client (vite build, server $Server)" { & $npm run build }
    if ($Integration) { Run "Server integration tests (wrangler dev)" { & $npm run test:integration } }

    $js = Get-ChildItem (Join-Path $root "web\dist\assets") -Filter *.js | Measure-Object Length -Sum
    $all = Get-ChildItem (Join-Path $root "web\dist") -Recurse -File | Measure-Object Length -Sum
    Write-Host ("Web client: {0:N0} KB of script, {1:N0} KB in total" -f ($js.Sum / 1KB), ($all.Sum / 1KB)) -ForegroundColor Green

    # ---- Windows app ------------------------------------------------------------------------
    $running = Get-Process LudoRoyale -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($publish, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) { throw "Ludo Royale is running from $publish - quit it and build again." }
    if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
    Run "Windows app $Version (.NET Framework 4.8, AnyCPU)" { & $dotnet publish $project -c Release -o $publish "-p:Version=$Version" "-p:LudoServer=$Server" -p:DebugType=none -nologo -v q }
    # Not needed at run time: API docs, debug symbols and the WinForms flavour of the WebView2 control.
    Get-ChildItem $publish -Recurse -Include *.xml, *.pdb -File | Remove-Item -Force
    Remove-Item (Join-Path $publish "Microsoft.Web.WebView2.WinForms.dll") -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $publish "web\_headers") -ErrorAction SilentlyContinue
    if (-not (Test-Path (Join-Path $publish "web\index.html"))) { throw "The web client is missing from $publish\web" }

    if (Test-Path $dist) { Get-ChildItem $dist -File | Remove-Item -Force } else { New-Item -ItemType Directory $dist | Out-Null }

    # ---- installer and portable zip ----------------------------------------------------------
    if (-not $SkipInstaller) {
        Run "Installer (Inno Setup)" { & $iscc /Q "/DAppVersion=$Version" "/DServerUrl=$Server" (Join-Path $root "windows\installer\LudoRoyale.iss") }
    }
    $zip = Join-Path $dist "LudoRoyale-$Version-portable.zip"
    Write-Host "==> Portable zip" -ForegroundColor Cyan
    $staging = Join-Path $root "publish\portable\Ludo Royale"
    if (Test-Path (Split-Path $staging)) { Remove-Item (Split-Path $staging) -Recurse -Force }
    New-Item -ItemType Directory $staging -Force | Out-Null
    Copy-Item (Join-Path $publish "*") $staging -Recurse
    Compress-Archive -Path $staging -DestinationPath $zip -CompressionLevel Optimal

    $files = Get-ChildItem $dist -File | Where-Object { $_.Name -like "LudoRoyale-*" } | Sort-Object Name
    $sums = $files | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name }
    [System.IO.File]::WriteAllLines((Join-Path $dist "SHA256SUMS.txt"), [string[]]$sums, (New-Object System.Text.UTF8Encoding($false)))

    New-Item -ItemType Directory $release -Force | Out-Null
    Get-ChildItem $release -File | Remove-Item -Force
    Copy-Item (Join-Path $dist "*") $release
    foreach ($f in $files) { Write-Host ("Done: {0} ({1:N2} MB)" -f $f.Name, ($f.Length / 1MB)) -ForegroundColor Green }
}
finally {
    Pop-Location
}
