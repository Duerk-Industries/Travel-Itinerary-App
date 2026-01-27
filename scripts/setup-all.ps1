param(
  [Parameter(Position = 0)]
  [string]$EnvFile = '',
  [switch]$SkipLogin
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

function Usage {
  Write-Error "Usage: $PSCommandPath [-SkipLogin] [path/to/.secrets|.env]"
  Write-Error "Runs configure-gcloud, enable-gcp-apis, configure-gcp-iam, and configure-run-env."
  exit 1
}

function Strip-InlineComment([string]$Line) {
  $out = ''
  $inSingle = $false
  $inDouble = $false
  $escaped = $false
  for ($i = 0; $i -lt $Line.Length; $i++) {
    $ch = $Line[$i]
    if ($escaped) {
      $out += $ch
      $escaped = $false
      continue
    }
    if ($ch -eq '\') {
      $out += $ch
      $escaped = $true
      continue
    }
    if ($ch -eq "'" -and -not $inDouble) {
      $inSingle = -not $inSingle
      $out += $ch
      continue
    }
    if ($ch -eq '"' -and -not $inSingle) {
      $inDouble = -not $inDouble
      $out += $ch
      continue
    }
    if ($ch -eq '#' -and -not $inSingle -and -not $inDouble) {
      $prev = if ($i -gt 0) { $Line[$i - 1] } else { '' }
      if ($i -eq 0 -or $prev -eq ' ' -or $prev -eq "`t") {
        break
      }
    }
    $out += $ch
  }
  return $out
}

function Parse-DotEnv([string]$Path) {
  $pairs = @()
  foreach ($raw in Get-Content -LiteralPath $Path) {
    $line = $raw.TrimEnd("`r")
    $line = $line.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    if ($line.StartsWith('export ')) { $line = $line.Substring(7) }
    $line = Strip-InlineComment $line
    $line = $line.Trim()
    if ($line -notmatch '=') { continue }
    $key = ($line -split '=', 2)[0].Trim()
    $value = ($line -split '=', 2)[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($key) { $pairs += [pscustomobject]@{ Key = $key; Value = $value } }
  }
  return $pairs
}

if (-not $EnvFile) {
  $candidates = @(
    (Join-Path $repoRoot 'server/.secrets'),
    (Join-Path $repoRoot 'server/.env'),
    (Join-Path $repoRoot '.env')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      $EnvFile = $candidate
      break
    }
  }
} elseif (-not (Test-Path -LiteralPath $EnvFile)) {
  $resolved = Join-Path $repoRoot $EnvFile
  if (Test-Path -LiteralPath $resolved) {
    $EnvFile = $resolved
  }
}

if ($EnvFile -and -not (Test-Path -LiteralPath $EnvFile)) {
  Write-Error "Env file not found: $EnvFile"
  exit 1
}

$projectId = $env:GCLOUD_PROJECT_ID
if (-not $projectId) {
  $searchFiles = @()
  if ($EnvFile) { $searchFiles += $EnvFile }
  $searchFiles += @(
    (Join-Path $repoRoot 'server/.secrets'),
    (Join-Path $repoRoot 'server/.env'),
    (Join-Path $repoRoot '.env')
  ) | Select-Object -Unique

  foreach ($file in $searchFiles) {
    if (-not (Test-Path -LiteralPath $file)) { continue }
    foreach ($pair in (Parse-DotEnv $file)) {
      if ($pair.Key -eq 'GCLOUD_PROJECT_ID') {
        $projectId = $pair.Value
        break
      }
    }
    if ($projectId) { break }
  }
}

if (-not $projectId) {
  Write-Error "GCLOUD_PROJECT_ID is required (set env or add to .secrets/.env)."
  exit 1
}

if (-not $SkipLogin) {
  & "$PSScriptRoot/configure-gcloud.ps1" $projectId
}

& "$PSScriptRoot/enable-gcp-apis.ps1"
if ($EnvFile) {
  & "$PSScriptRoot/configure-gcp-iam.ps1" $EnvFile
  if ([System.IO.Path]::GetFileName($EnvFile) -eq '.secrets') {
    $envFallback = Join-Path $repoRoot 'server/.env'
    if (Test-Path -LiteralPath $envFallback) {
      & "$PSScriptRoot/configure-run-env.ps1" $envFallback
    } else {
      & "$PSScriptRoot/configure-run-env.ps1"
    }
  } else {
    & "$PSScriptRoot/configure-run-env.ps1" $EnvFile
  }
} else {
  & "$PSScriptRoot/configure-gcp-iam.ps1"
  & "$PSScriptRoot/configure-run-env.ps1"
}

Write-Host "Setup completed."
