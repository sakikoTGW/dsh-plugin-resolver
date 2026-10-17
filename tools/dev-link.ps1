# Re-point the installed generation's `logic/` directory at this checkout so
# logic edits are live without reinstalling or restarting DSH.
$ErrorActionPreference = 'Stop'
$genRoot = Join-Path $env:APPDATA 'dsh-desktop\harness\profiles\.generations\live'
$gen = Get-ChildItem $genRoot -Directory | Where-Object { $_.Name -like 'dsh-plugin-resolver+*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $gen) { throw 'no installed dsh-plugin-resolver generation found' }
$pkg = Join-Path $gen.FullName 'node_modules\dsh-plugin-resolver'
$target = Join-Path $PSScriptRoot 'logic'
$link = Join-Path $pkg 'logic'
if ((Test-Path $link) -and ((Get-Item $link -Force).LinkType)) { Remove-Item $link -Force }
elseif (Test-Path $link) { Remove-Item $link -Recurse -Force }
New-Item -ItemType Junction -Path $link -Target $target | Out-Null
Write-Output "linked $link -> $target"
