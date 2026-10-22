param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [string]$InstallDir,
  [string]$PublishDir,
  [string]$ArtifactRoot
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'windows-build-inputs.ps1')

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (!$ArtifactRoot) {
  $ArtifactRoot = Join-Path $Root "artifacts"
}
if (!$InstallDir) {
  $InstallDir = Join-Path $env:TEMP "nostr-vpn-installer-smoke"
}

$InstallerPath = [System.IO.Path]::GetFullPath($InstallerPath)
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$ArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)

if (!(Test-Path $InstallerPath)) {
  throw "Windows installer not found: $InstallerPath"
}

New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
$ownedExe = Join-Path $InstallDir 'NostrVpn.Windows.exe'
Get-CimInstance Win32_Process -Filter "Name = 'NostrVpn.Windows.exe'" |
  Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $ownedExe } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue

try {
  $installArgs = @(
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/DIR=$InstallDir"
  )
  $setup = Start-Process -FilePath $InstallerPath -ArgumentList $installArgs -Wait -PassThru
  if ($setup.ExitCode -ne 0) {
    throw "Installer exited with code $($setup.ExitCode)"
  }

  $appExe = Join-Path $InstallDir "NostrVpn.Windows.exe"
  if (!(Test-Path $appExe)) {
    throw "Installed Windows app not found: $appExe"
  }

  & (Join-Path $PSScriptRoot "windows-app-launch-smoke.ps1") -AppExe $appExe -ArtifactRoot $ArtifactRoot -NoWindowRequired

  $payloadFiles = [ordered]@{
    app = [ordered]@{ File = 'NostrVpn.Windows.exe'; Path = $appExe }
    appCore = [ordered]@{
      File = 'nostr_vpn_app_core.dll'
      Path = Join-Path $InstallDir 'nostr_vpn_app_core.dll'
    }
    cli = [ordered]@{
      File = 'nvpn.exe'
      Path = Join-Path $InstallDir 'nvpn.exe'
    }
    wintun = [ordered]@{
      File = 'binaries\wintun.dll'
      Path = Join-Path $InstallDir 'binaries\wintun.dll'
    }
  }
  $installedPayloads = [ordered]@{}
  foreach ($entry in $payloadFiles.GetEnumerator()) {
    if (!(Test-Path -LiteralPath $entry.Value.Path -PathType Leaf)) {
      throw "Installed Windows payload is missing: $($entry.Value.File)"
    }
    $installedPayloads[$entry.Key] = [ordered]@{
      file = $entry.Value.File
      sha256 = (
        Get-NvpnFileHash -Algorithm SHA256 -LiteralPath $entry.Value.Path
      ).Hash.ToLowerInvariant()
      size = (Get-Item -LiteralPath $entry.Value.Path).Length
    }
  }
  if ($PublishDir) {
    $installedFiles = [ordered]@{}
    $publishRoot = [IO.Path]::GetFullPath($PublishDir)
    foreach ($file in Get-ChildItem -LiteralPath $publishRoot -File -Recurse -Force) {
      $name = $file.FullName.Substring($publishRoot.Length + 1).Replace([char]92, [char]47)
      $installed = Join-Path $InstallDir $name
      if (!(Test-Path -LiteralPath $installed -PathType Leaf)) { throw "Installed payload is missing $name" }
      $hash = (Get-NvpnFileHash -LiteralPath $installed -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($hash -ne (Get-NvpnFileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) {
        throw "Installed payload differs from publish directory: $name"
      }
      $installedFiles[$name] = [ordered]@{ sha256 = $hash; size = (Get-Item -LiteralPath $installed).Length }
    }
    $installedFiles | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $ArtifactRoot 'installed-files.json')
  }
  $smokePath = Join-Path $ArtifactRoot 'windows-app-launch-smoke.json'
  $smokeResult = Get-Content -Raw -LiteralPath $smokePath | ConvertFrom-Json
  $smokeResult | Add-Member -NotePropertyName installedPayloads `
    -NotePropertyValue ([pscustomobject]$installedPayloads)
  $smokeResult | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 `
    -LiteralPath $smokePath
  Write-Host "WINDOWS_INSTALLER_SMOKE_OK"
} finally {
  $uninstaller = Join-Path $InstallDir "unins000.exe"
  if (Test-Path $uninstaller) {
    $uninstallArgs = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART")
    Start-Process -FilePath $uninstaller -ArgumentList $uninstallArgs -Wait -ErrorAction SilentlyContinue | Out-Null
  }
}
