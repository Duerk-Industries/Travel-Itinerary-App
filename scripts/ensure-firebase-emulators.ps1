#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RootDir

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

function Get-LastCommandExitCode {
  param([bool]$CommandSucceeded)

  if ($CommandSucceeded) {
    return 0
  }

  $lastExitCodeVariable = Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
  if ($null -ne $lastExitCodeVariable -and $null -ne $lastExitCodeVariable.Value) {
    return [int]$lastExitCodeVariable.Value
  }
  return 1
}

$OpenPort = $null
foreach ($port in $Ports) {
  if (Test-PortOpen -Port $port) {
    $OpenPort = $port
    break
  }
}

if ($null -ne $OpenPort) {
  Write-Host "Firebase emulators appear to be running (port $OpenPort is accepting connections)."
  exit 0
}

$LocalFirebase = Join-Path $RootDir "node_modules/.bin/firebase"
$SelectScript = Join-Path $RootDir "scripts/select-latest-firebase-export.mjs"
if (Test-Path $SelectScript) {
  node $SelectScript
  $selectExitCode = Get-LastCommandExitCode -CommandSucceeded $?
  if ($selectExitCode -ne 0) {
    exit $selectExitCode
  }
}

if (Test-Path $LocalFirebase) {
  Write-Host "Firebase emulators not detected. Starting..."
  & $LocalFirebase emulators:start --import=./.firebase-data --export-on-exit=./.firebase-data
  exit (Get-LastCommandExitCode -CommandSucceeded $?)
} elseif (Get-Command firebase -ErrorAction SilentlyContinue) {
  Write-Host "Firebase emulators not detected. Starting..."
  & firebase emulators:start --import=./.firebase-data --export-on-exit=./.firebase-data
  exit (Get-LastCommandExitCode -CommandSucceeded $?)
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
  Write-Host "Firebase emulators not detected. Starting..."
  & npx --yes firebase-tools emulators:start --import=./.firebase-data --export-on-exit=./.firebase-data
  exit (Get-LastCommandExitCode -CommandSucceeded $?)
} else {
  Write-Error "firebase CLI not found. Install firebase-tools or ensure npx is available."
  exit 1
}
