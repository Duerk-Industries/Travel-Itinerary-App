#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RootDir

$DataDir = if ($env:FIREBASE_DATA_DIR) { $env:FIREBASE_DATA_DIR } else { Join-Path $RootDir ".firebase-data" }
$UiPort = 4001
$Ports = @(4001, 8080, 9099, 9199, 5001, 5000)

function Test-PortOpen {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $connected = $iar.AsyncWaitHandle.WaitOne(300)
    if (-not $connected) {
      $client.Close()
      return $false
    }
    $client.EndConnect($iar)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

$OpenPort = $null
foreach ($port in $Ports) {
  if (Test-PortOpen -Port $port) {
    $OpenPort = $port
    break
  }
}

if ($null -eq $OpenPort) {
  Write-Host "Firebase emulators do not appear to be running."
  exit 0
}

if (Get-Command firebase -ErrorAction SilentlyContinue) {
  Write-Host "Exporting emulator data to $DataDir..."
  & firebase emulators:export --force $DataDir
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Export failed; attempting graceful shutdown anyway."
  }
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
  Write-Host "Exporting emulator data to $DataDir..."
  & npx firebase emulators:export --force $DataDir
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Export failed; attempting graceful shutdown anyway."
  }
} else {
  Write-Warning "firebase CLI not found; skipping explicit export."
}

$ProjectId = $env:GCLOUD_PROJECT_ID
if (-not $ProjectId) { $ProjectId = $env:GOOGLE_CLOUD_PROJECT }
if (-not $ProjectId -and (Test-Path ".firebaserc")) {
  try {
    $rc = Get-Content ".firebaserc" -Raw | ConvertFrom-Json
    if ($rc.projects.default) {
      $ProjectId = $rc.projects.default
    } elseif ($rc.projects.current) {
      $ProjectId = $rc.projects.current
    } else {
      $first = $rc.projects.PSObject.Properties | Select-Object -First 1
      if ($first) { $ProjectId = $first.Value }
    }
  } catch {
    $ProjectId = $null
  }
}

if (-not $ProjectId) {
  Write-Error "Could not determine Firebase project id for graceful shutdown. Set GCLOUD_PROJECT_ID or ensure .firebaserc exists."
  exit 1
}

$ShutdownUrl = "http://127.0.0.1:$UiPort/emulator/v1/projects/${ProjectId}:shutdown"
Write-Host "Sending shutdown signal to Firebase emulators (project $ProjectId)..."
try {
  Invoke-RestMethod -Method Post -Uri $ShutdownUrl | Out-Null
} catch {
  Write-Warning "Shutdown request failed or emulator stopped immediately. Waiting for ports to close."
}

for ($i = 0; $i -lt 40; $i++) {
  if (-not (Test-PortOpen -Port $UiPort)) {
    Write-Host "Firebase emulators stopped and export should be flushed."
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

Write-Error "Timed out waiting for Firebase emulators to stop. Check running processes."
exit 1
