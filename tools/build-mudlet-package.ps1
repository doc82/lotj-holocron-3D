param(
  [string]$MuddlerHome = $env:MUDDLER_HOME
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageRoot = Join-Path $projectRoot "mudlet-package"
$resources = Join-Path $packageRoot "src\resources"

if (-not $MuddlerHome) {
  $siblingMuddler = Join-Path (Split-Path -Parent $projectRoot) "AutoPilot\muddler"
  if (Test-Path -LiteralPath $siblingMuddler) { $MuddlerHome = $siblingMuddler }
}
if (-not $MuddlerHome) {
  throw "Set MUDDLER_HOME to a Muddler distribution directory."
}

$muddle = Join-Path $MuddlerHome "bin\muddle.bat"
if (-not (Test-Path -LiteralPath $muddle)) {
  throw "Muddler launcher was not found at $muddle"
}

New-Item -ItemType Directory -Path $resources -Force | Out-Null
foreach ($name in @(
  "lotj_holocron_parsers.lua",
  "lotj_holocron_proxy.lua",
  "lotj_holocron_scraper.lua"
)) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "mudlet\$name") -Destination $resources -Force
}

Push-Location $packageRoot
try {
  & $muddle
  if ($LASTEXITCODE -ne 0) { throw "Muddler failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$outputDirectory = Join-Path $projectRoot "out\mudlet"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$package = Join-Path $packageRoot "build\Holocron3D.mpackage"
if (-not (Test-Path -LiteralPath $package)) { throw "Muddler did not produce $package" }
Copy-Item -LiteralPath $package -Destination $outputDirectory -Force
Write-Output (Join-Path $outputDirectory "Holocron3D.mpackage")
