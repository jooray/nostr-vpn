param(
  [Parameter(Mandatory = $true)][string]$PublishDir,
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$InstalledManifestPath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-build-inputs.ps1')
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$PublishDir = [IO.Path]::GetFullPath($PublishDir)
$installed = Get-Content -Raw -LiteralPath $InstalledManifestPath | ConvertFrom-Json
if (@(Get-ChildItem -LiteralPath $PublishDir -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
  throw 'Portable payload contains a reparse point'
}
$files = @(Get-ChildItem -LiteralPath $PublishDir -File -Recurse -Force | Sort-Object FullName)
if (!$files.Count) { throw 'Empty Windows publish directory' }
$manifest = [ordered]@{}
foreach ($file in $files) {
  if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Portable payload contains a reparse point' }
  $name = $file.FullName.Substring($PublishDir.Length + 1).Replace([char]92, [char]47)
  $hash = (Get-NvpnFileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $actual = $installed.PSObject.Properties[$name].Value
  if (!$actual -or $actual.sha256 -ne $hash -or [long]$actual.size -ne $file.Length) {
    throw "Portable payload differs from installed file: $name"
  }
  $manifest[$name] = [ordered]@{ sha256 = $hash; size = $file.Length }
}
if (@($installed.PSObject.Properties).Count -ne $files.Count) { throw 'Installed and portable file sets differ' }
$zip = [IO.Compression.ZipFile]::Open($ArchivePath, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($name in $manifest.Keys) {
    $entry = $zip.CreateEntry($name)
    $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
    $inputStream = [IO.File]::OpenRead((Join-Path $PublishDir $name))
    try {
      $outputStream = $entry.Open()
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
    } finally { $inputStream.Dispose() }
  }
} finally { $zip.Dispose() }
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 -LiteralPath "$ArchivePath.files.json"
