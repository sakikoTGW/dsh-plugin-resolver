# Re-point the installed package's `logic/` directory at this checkout so
# logic edits are live without reinstalling or restarting DSH.
#
# The profile is resolved from -ProfileDir, $DSH_PROFILE_DIR, or
# $DSH_HOME/profiles/$DSH_PROFILE. Installed layouts differ between hosts:
# some keep the package directly under <profile>/node_modules, others unpack
# a generation under <profile>/.generations/live/<bundle>+<version>-<hash>.
param([string]$ProfileDir = $env:DSH_PROFILE_DIR)
$ErrorActionPreference = 'Stop'

if (-not $ProfileDir) {
    $homeDir = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
    $profileName = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
    $ProfileDir = Join-Path (Join-Path $homeDir 'profiles') $profileName
}
if (-not (Test-Path $ProfileDir)) { throw "profile directory not found: $ProfileDir" }

$pkg = $null
$genRoot = Join-Path $ProfileDir '.generations\live'
if (Test-Path $genRoot) {
    $gen = Get-ChildItem $genRoot -Directory |
        Where-Object { $_.Name -like 'dsh-plugin-resolver+*' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($gen) { $pkg = Join-Path $gen.FullName 'node_modules\dsh-plugin-resolver' }
}
if (-not $pkg -or -not (Test-Path $pkg)) {
    $candidate = Join-Path (Join-Path $ProfileDir 'node_modules') 'dsh-plugin-resolver'
    if (Test-Path $candidate) { $pkg = $candidate }
}
if (-not $pkg -or -not (Test-Path $pkg)) { throw "no installed dsh-plugin-resolver found under $ProfileDir" }

$target = Join-Path $PSScriptRoot 'logic'
$link = Join-Path $pkg 'logic'
if ((Test-Path $link) -and ((Get-Item $link -Force).LinkType)) { Remove-Item $link -Force }
elseif (Test-Path $link) { Remove-Item $link -Recurse -Force }
New-Item -ItemType Junction -Path $link -Target $target | Out-Null
Write-Output "linked $link -> $target"
