$ErrorActionPreference = 'Stop'

$ServiceName = if ($env:SERVICE_NAME) { $env:SERVICE_NAME } else { 'travel-itinerary-app' }
$Region = if ($env:REGION) { $env:REGION } else { 'us-east5' }
$SourceDir = if ($env:SOURCE_DIR) { $env:SOURCE_DIR } else { 'server' }
$EnvFile = if ($env:ENV_FILE) { $env:ENV_FILE } else { '' }
$IgnoreKeys = if ($env:IGNORE_KEYS) { $env:IGNORE_KEYS } else { 'PORT,FIRESTORE_EMULATOR_HOST,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,FIRESTORE_DATABASE_ID' }

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

function Should-IgnoreKey([string]$Key, [string]$List) {
  $keys = $List -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  return $keys -contains $Key
}

Write-Host "Deploying Cloud Run service source code..."
Write-Host "  Service: $ServiceName"
Write-Host "  Region: $Region"
Write-Host "  Source: $SourceDir"

if (-not $EnvFile) {
  if (Test-Path -LiteralPath 'server/.env') {
    $EnvFile = 'server/.env'
  } elseif (Test-Path -LiteralPath '.env') {
    $EnvFile = '.env'
  }
}

$envPairs = @()
if ($EnvFile) {
  if ([System.IO.Path]::GetFileName($EnvFile) -eq '.local_env') {
    Write-Error "Refusing to read .local_env for Cloud Run env vars."
    exit 1
  }
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-Error "Env file not found: $EnvFile"
    exit 1
  }
  foreach ($pair in (Parse-DotEnv $EnvFile)) {
    if (Should-IgnoreKey $pair.Key $IgnoreKeys) { continue }
    $value = $pair.Value
    if ($pair.Key -eq 'AUTH_REDIRECT_URI_ALLOWLIST') {
      $value = ($value -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
      $value = ($value -join ';')
    }
    $value = $value -replace ',', '\,'
    $envPairs += "$($pair.Key)=$value"
  }
}

$envArg = ''
if ($envPairs.Count -gt 0) {
  $envArg = ($envPairs -join ',')
  Write-Host "Non-secret env vars to upload:"
  foreach ($pair in $envPairs) {
    Write-Host "  $pair"
  }
}

$cmd = @('run', 'deploy', $ServiceName, '--source', $SourceDir, '--region', $Region)
if ($envArg) { $cmd += @('--update-env-vars', $envArg) }
if (Should-IgnoreKey 'FIRESTORE_EMULATOR_HOST' $IgnoreKeys) { $cmd += @('--remove-env-vars', 'FIRESTORE_EMULATOR_HOST') }

& gcloud @cmd

Write-Host "API deployment completed."
