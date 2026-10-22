param(
  [Parameter(Mandatory = $true)][string]$PublishDir,
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$InstalledManifestPath,
  [Parameter(Mandatory = $true)][string]$ArtifactRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-build-inputs.ps1')
$ArtifactRoot = [IO.Path]::GetFullPath($ArtifactRoot)
New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
$name = [IO.Path]::GetFileName($InstallerPath).Replace('-setup.exe', '.zip')
if ($name -notmatch '^nostr-vpn-v.+-windows-x64\.zip$') { throw 'Unexpected installer name' }
$archive = Join-Path $ArtifactRoot $name
& (Join-Path $PSScriptRoot 'windows-portable-package.ps1') -PublishDir $PublishDir -ArchivePath $archive -InstalledManifestPath $InstalledManifestPath
$extracted = Join-Path $ArtifactRoot 'extracted'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($archive, $extracted)
$smokeDir = Join-Path $ArtifactRoot 'launch'
& (Join-Path $PSScriptRoot 'windows-app-launch-smoke.ps1') -AppExe (Join-Path $extracted 'NostrVpn.Windows.exe') -ArtifactRoot $smokeDir -NoWindowRequired
$smokePath = Join-Path $smokeDir 'windows-app-launch-smoke.json'
if ((Get-Content -Raw -LiteralPath $smokePath | ConvertFrom-Json).ok -ne $true) { throw 'Portable GUI did not pass launch gate' }
$manifest = Get-Content -Raw -LiteralPath "$archive.files.json" | ConvertFrom-Json
# This is an artifact-preparation receipt, not a complete service/network gate.
[ordered]@{
  kind = 'windows-portable-preparation'
  testScope = $env:NVPN_WINDOWS_TEST_SCOPE
  source = (& git -C (Split-Path $PSScriptRoot) rev-parse HEAD | Out-String).Trim()
  tree = (& git -C (Split-Path $PSScriptRoot) rev-parse 'HEAD^{tree}' | Out-String).Trim()
  sdk = (& dotnet --version | Out-String).Trim()
  installer = [ordered]@{
    name = [IO.Path]::GetFileName($InstallerPath)
    sha256 = (Get-NvpnFileHash -LiteralPath $InstallerPath).Hash.ToLowerInvariant()
    size = (Get-Item -LiteralPath $InstallerPath).Length
  }
  portable = [ordered]@{
    name = $name
    sha256 = (Get-NvpnFileHash -LiteralPath $archive).Hash.ToLowerInvariant()
    size = (Get-Item -LiteralPath $archive).Length
    launched = $true
    smokeReceiptSha256 = (Get-NvpnFileHash -LiteralPath $smokePath).Hash.ToLowerInvariant()
    files = $manifest
  }
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $ArtifactRoot 'preparation-receipt.json')
