param(
  [string]$ExtensionId,
  [switch]$Verify
)

$ErrorActionPreference = 'Stop'

$RegBase = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts'
$HostName = 'com.voitechnology.zendesk_fm_assistant'
$HostPath = Join-Path $PSScriptRoot 'host.cmd'
$NodePath = 'C:\Program Files\nodejs\node.exe'
$ManifestDir = Join-Path $env:LOCALAPPDATA 'com.voitechnology.zendesk_fm_assistant'
$ManifestPath = Join-Path $ManifestDir 'host.json'

if ($Verify) {
  $regPath = Join-Path $RegBase $HostName
  if (-not (Test-Path $regPath)) {
    Write-Host "VERIFY FAILED: Registry path missing: $regPath"
    Write-Host "Run without -Verify and provide -ExtensionId to register."
    exit 1
  }
  $storedPath = Get-ItemProperty -LiteralPath $regPath -Name '(Default)' -ErrorAction SilentlyContinue
  if (-not $storedPath -or -not (Test-Path $storedPath.'(default)')) {
    Write-Host "VERIFY FAILED: Manifest path not found or invalid: $($storedPath.'(default)')"
    exit 1
  }
  Write-Host "VERIFY OK: Registry entry exists at $regPath"
  Write-Host "  Manifest: $($storedPath.'(default)')"
  $manifestJson = Get-Content -LiteralPath $storedPath.'(default)' -Raw | ConvertFrom-Json
  Write-Host "  Allowed origins: $($manifestJson.allowed_origins -join ', ')"
  exit 0
}

if (-not (Test-Path $NodePath)) {
  Write-Error "Node.js not found at $NodePath. Install Node.js or edit this script."
}

if (-not (Test-Path $HostPath)) {
  Write-Error "Host script not found at $HostPath"
}

if (-not $ExtensionId) {
  Write-Warning "Extension ID not provided. Open chrome://extensions, find VOI Zendesk FM Assistant, copy the ID, then re-run:"
  Write-Warning "  .\register-host.ps1 -ExtensionId <your-extension-id>"
  Write-Warning ""
  Write-Warning "Example extension ID format: abcdefghijklmnopabcdefghijklmnop"
  Write-Warning ""
  Write-Warning "To verify an existing registration:"
  Write-Warning "  .\register-host.ps1 -Verify"
  exit 1
}

$allowedOrigin = 'chrome-extension://' + $ExtensionId + '/'

$Manifest = @{
  name = $HostName
  description = 'VOI Zendesk + FM Extension Native Host'
  path = $HostPath
  type = 'stdio'
  allowed_origins = @($allowedOrigin)
} | ConvertTo-Json -Compress

if (-not (Test-Path $ManifestDir)) { New-Item -ItemType Directory -Path $ManifestDir -Force | Out-Null }
Set-Content -LiteralPath $ManifestPath -Value $Manifest -Encoding UTF8

if (-not (Test-Path $RegBase)) {
  New-Item -ItemType Directory -Path $RegBase -Force | Out-Null
}

$RegPath = Join-Path $RegBase $HostName
if (-not (Test-Path $RegPath)) {
  New-Item -ItemType Directory -Path $RegPath -Force | Out-Null
}
Set-ItemProperty -LiteralPath $RegPath -Name '(Default)' -Value $ManifestPath -Type String

Write-Host "Native host registered successfully:"
Write-Host "  Extension ID: $ExtensionId"
Write-Host "  Registry:     $RegPath"
Write-Host "  Manifest:     $ManifestPath"
Write-Host "  Node:         $NodePath"
Write-Host "  Allowed:      $allowedOrigin"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Load extension in Chrome (chrome://extensions -> Load unpacked -> D:\SHETFUEK\extension)"
Write-Host "  2. Start Ollama: & `"$($NodePath)`" is NOT needed; start Ollama with your launcher"
Write-Host "  3. Open Zendesk ticket, click Classify with AI"
Write-Host "  4. Verify with: .\register-host.ps1 -Verify"
