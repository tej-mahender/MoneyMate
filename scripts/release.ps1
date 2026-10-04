<#
.SYNOPSIS
  Builds a signed, reproducible Money Mate release (AAB for Play + APK for sideloading).

.DESCRIPTION
  Always builds from a clean web bundle so stale assets can never end up in a
  release (the Android project keeps its own copy of the web app under
  android/app/src/main/assets/public, which goes out of date silently).

  Steps: preflight (signing + clean git tree) -> lint + tests -> remove dist and
  the copied Android web assets -> npm run build -> cap sync -> bump versionCode
  -> gradle clean bundleRelease assembleRelease -> copy outputs to .\release\

  Run from anywhere:   .\scripts\release.ps1
  Useful switches:     -Install        run `npm ci` first (fresh, locked dependencies)
                       -NoBump         keep the current versionCode (rebuild same version)
                       -VersionName 1.1  set the user-visible version name
                       -SkipChecks     skip lint + tests (not recommended)
                       -AllowDirty     allow uncommitted changes (not recommended)
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$NoBump,
  [switch]$SkipChecks,
  [switch]$AllowDirty,
  [string]$VersionName
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Run($cmd) {
  Write-Host "   $cmd" -ForegroundColor DarkGray
  Invoke-Expression $cmd
  if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $cmd" }
}

# --- Preflight ---------------------------------------------------------------
Step "Preflight"
$keystoreProps = Join-Path $root "android\keystore.properties"
if (-not (Test-Path $keystoreProps)) {
  throw "android\keystore.properties not found. Create it first (see README: Configure Release Signing)."
}
$dirty = git status --porcelain
if ($dirty -and -not $AllowDirty) {
  Write-Host $dirty
  throw "Working tree has uncommitted changes. Commit or stash them so the build matches a commit (or pass -AllowDirty)."
}
$commit = (git rev-parse --short HEAD).Trim()

# --- Dependencies + checks ---------------------------------------------------
if ($Install) { Step "Installing locked dependencies"; Run "npm ci" }
if (-not $SkipChecks) {
  Step "Lint + tests"
  Run "npm run lint"
  Run "npm test"
}

# --- Clean web build + sync --------------------------------------------------
Step "Cleaning stale web output"
Remove-Item -Recurse -Force (Join-Path $root "dist") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $root "android\app\src\main\assets\public") -ErrorAction SilentlyContinue

Step "Building web app"
Run "npm run build"

Step "Syncing into the Android project"
Run "npx cap sync android"
if (-not (Test-Path (Join-Path $root "android\app\src\main\assets\public\index.html"))) {
  throw "cap sync did not produce android\app\src\main\assets\public\index.html"
}

# --- Version bump ------------------------------------------------------------
$versionFile = Join-Path $root "android\version.properties"
$originalVersionText = Get-Content $versionFile -Raw
$props = @{}
foreach ($line in (Get-Content $versionFile)) {
  if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)$') { $props[$matches[1]] = $matches[2].Trim() }
}
$code = [int]$props["versionCode"]
$name = $props["versionName"]
if (-not $NoBump) { $code += 1 }
if ($VersionName) { $name = $VersionName }
Step "Version $name (versionCode $code)"
Set-Content -Path $versionFile -Value "versionCode=$code`r`nversionName=$name" -NoNewline

# --- Gradle ------------------------------------------------------------------
try {
  Step "Building signed AAB + APK"
  Push-Location (Join-Path $root "android")
  try { Run ".\gradlew.bat clean bundleRelease assembleRelease" } finally { Pop-Location }
} catch {
  # Don't burn a versionCode on a build that never produced anything.
  Set-Content -Path $versionFile -Value $originalVersionText -NoNewline
  throw
}

# --- Collect outputs ---------------------------------------------------------
Step "Collecting outputs"
$outDir = Join-Path $root "release"
New-Item -ItemType Directory -Force $outDir | Out-Null
$base = "MoneyMate-$name-vc$code-$commit"
$aab = Join-Path $root "android\app\build\outputs\bundle\release\app-release.aab"
$apk = Join-Path $root "android\app\build\outputs\apk\release\app-release.apk"
foreach ($pair in @(@($aab, "$base.aab"), @($apk, "$base.apk"))) {
  if (-not (Test-Path $pair[0])) { throw "Expected output missing: $($pair[0])" }
  $dest = Join-Path $outDir $pair[1]
  Copy-Item $pair[0] $dest -Force
  $hash = (Get-FileHash $dest -Algorithm SHA256).Hash
  Write-Host ("   {0}`n     SHA256 {1}" -f $dest, $hash)
}

Write-Host "`nDone. Upload the .aab to Play; use the .apk for sideload testing." -ForegroundColor Green
Write-Host "Commit android\version.properties so the next build bumps from $code." -ForegroundColor Yellow
