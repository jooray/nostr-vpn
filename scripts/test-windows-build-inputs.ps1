param([switch]$GenerateLock, [string]$ArtifactRoot)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
foreach ($name in @('windows-build.ps1', 'windows-build-inputs.ps1', 'windows-portable-package.ps1', 'windows-portable-smoke.ps1', 'windows-app-launch-smoke.ps1', 'windows-installer-smoke.ps1', 'test-windows-build-inputs.ps1')) {
  $tokens = $null
  $parseErrors = $null
  [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
}
$projectDir = Join-Path $root 'windows/NostrVpn.Windows'
$project = Join-Path $projectDir 'NostrVpn.Windows.csproj'
if (!$ArtifactRoot) { $ArtifactRoot = Join-Path $root 'artifacts/windows-build-inputs' }
. (Join-Path $PSScriptRoot 'windows-build-inputs.ps1')
if ($GenerateLock) {
  & dotnet restore $project --runtime win-x64 -p:SelfContained=true -p:RestoreLockedMode=false --force-evaluate
  if ($LASTEXITCODE -ne 0) { throw 'Lock generation failed' }
}
$lock = Join-Path $projectDir 'packages.lock.json'
$before = (Get-NvpnFileHash -LiteralPath $lock -Algorithm SHA256).Hash
& dotnet restore $project --runtime win-x64 -p:SelfContained=true --locked-mode
if ($LASTEXITCODE -ne 0) { throw 'Locked restore failed' }
if ((Get-NvpnFileHash -LiteralPath $lock -Algorithm SHA256).Hash -ne $before) { throw 'Locked restore changed its lock file' }
$assets = Join-Path $projectDir 'obj/project.assets.json'
$pins = Join-Path $projectDir 'sdk-packages.json'
Assert-PinnedDownloadPackages -AssetsPath $assets -PinsPath $pins
$temp = Join-Path ([IO.Path]::GetTempPath()) ('nvpn-input-pins-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $badPins = Get-Content -Raw -LiteralPath $pins | ConvertFrom-Json
  foreach ($pin in $badPins) { $pin.sha512 = '0' * 128 }
  $badPath = Join-Path $temp 'bad-pins.json'
  $badPins | ConvertTo-Json | Set-Content -LiteralPath $badPath
  $rejected = $false
  try { Assert-PinnedDownloadPackages -AssetsPath $assets -PinsPath $badPath }
  catch { if ($_.Exception.Message -match 'content hash mismatch') { $rejected = $true } else { throw } }
  if (!$rejected) { throw 'Modified SDK archive pin was accepted' }
  $badAssets = Get-Content -Raw -LiteralPath $assets | ConvertFrom-Json
  foreach ($framework in $badAssets.project.frameworks.PSObject.Properties) {
    foreach ($download in $framework.Value.downloadDependencies) { $download.version = '[0.0.0, 0.0.0]' }
  }
  $badAssetsPath = Join-Path $temp 'bad-assets.json'
  $badAssets | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $badAssetsPath
  $versionRejected = $false
  try { Assert-PinnedDownloadPackages -AssetsPath $badAssetsPath -PinsPath $pins }
  catch { if ($_.Exception.Message -match 'no exact reviewed pin') { $versionRejected = $true } else { throw } }
  if (!$versionRejected) { throw 'Unpinned SDK download version was accepted' }
  New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
  Copy-Item -LiteralPath $lock -Destination (Join-Path $ArtifactRoot 'packages.lock.json')
  [ordered]@{
    ok = $true
    source = (& git -C $root rev-parse HEAD | Out-String).Trim()
    sdk = (& dotnet --version | Out-String).Trim()
    lockSha256 = $before.ToLowerInvariant()
    sdkPinsSha256 = (Get-NvpnFileHash -LiteralPath $pins -Algorithm SHA256).Hash.ToLowerInvariant()
    modifiedPinRejected = $rejected
    unpinnedVersionRejected = $versionRejected
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ArtifactRoot 'receipt.json')
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
Write-Host 'WINDOWS_PINNED_INPUTS_OK'
