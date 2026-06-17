param(
  [Parameter(Position = 0)]
  [string]$EnvFile = ''
)

$ErrorActionPreference = 'Stop'

$ServiceName = if ($env:SERVICE_NAME) { $env:SERVICE_NAME } else { 'travel-itinerary-app' }
$Region = if ($env:REGION) { $env:REGION } else { 'us-east5' }
$IgnoreKeys = if ($env:IGNORE_KEYS) { $env:IGNORE_KEYS } else { 'PORT,FIRESTORE_EMULATOR_HOST,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS' }
$IgnoreSecretKeys = if ($env:IGNORE_SECRET_KEYS) { $env:IGNORE_SECRET_KEYS } else { 'GCLOUD_PROJECT,GOOGLE_CLOUD_PROJECT,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS' }
$SecretsFile = if ($env:SECRETS_FILE) { $env:SECRETS_FILE } else { '' }
$Secrets = if ($env:SECRETS) { $env:SECRETS } else { '' }
$gcloudCommand = if (Get-Command gcloud.cmd -ErrorAction SilentlyContinue) { 'gcloud.cmd' } else { 'gcloud' }

function Usage {
  Write-Error "Usage: $PSCommandPath [path/to/.env]"
  Write-Error "Configures Cloud Run env vars from .env and optional Secret Manager mappings from .secrets/SECRETS without deploying code."
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

function Should-IgnoreKey([string]$Key, [string]$List) {
  $keys = $List -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  return $keys -contains $Key
}

function Is-VisibleEnvKey([string]$Key) {
  $visibleKeys = @(
    'GCLOUD_PROJECT_ID',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CALLBACK_URL',
    'LOCATION_BUCKET',
    'LOCATION_RAW_CSV_PREFIX',
    'FIRESTORE_DATABASE_ID',
    'DB_PROVIDER',
    'USE_IN_MEMORY_DB',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_FROM',
    'UNSPLASH_APP_ID',
    'UNSPLASH_IMAGE_CACHE_TIMEOUT_MINUTES',
    'SIGNED_IMAGE_URL_CACHE_TIMEOUT_MINUTES',
    'GOOGLE_PLACES_DETAILS_CACHE_TIMEOUT_MINUTES',
    'STORAGE_IMAGE_CACHE_CONTROL_TIMEOUT_MINUTES',
    'UNSPLASH_AUTH_BLOCK_CACHE_TIMEOUT_MINUTES',
    'SESSION_CACHE_TIMEOUT_MINUTES',
    'PLACE_MATCH_THRESHOLD',
    'AUTH_REDIRECT_URI_ALLOWLIST',
    'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
    'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'EXPO_PUBLIC_FIREBASE_APP_ID'
  )
  return $visibleKeys -contains $Key
}

function Get-DisplayEnvPair([string]$Pair) {
  $parts = $Pair -split '=', 2
  $key = $parts[0]
  $value = if ($parts.Length -gt 1) { $parts[1] } else { '' }
  if (Is-VisibleEnvKey $key) { return "$key=$value" }
  return "$key=<redacted>"
}

if (-not $EnvFile) {
  if (Test-Path -LiteralPath 'server/.env') {
    $EnvFile = 'server/.env'
  } elseif (Test-Path -LiteralPath '.env') {
    $EnvFile = '.env'
  } else {
    Write-Error "No .env file found. Provide one as the first argument."
    exit 1
  }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Write-Error "Env file not found: $EnvFile"
  exit 1
}

if ([System.IO.Path]::GetFileName($EnvFile) -eq '.local_env') {
  Write-Error "Refusing to configure using .local_env (local-only values should not be uploaded)."
  exit 1
}

if (-not $SecretsFile) {
  if (Test-Path -LiteralPath 'server/.secrets') {
    $SecretsFile = 'server/.secrets'
  } elseif (Test-Path -LiteralPath '.secrets') {
    $SecretsFile = '.secrets'
  }
}

$secretMap = @{}
$envPairs = @()
$envKeys = @()
$projectId = ''
$sawGoogleApplicationCredentials = $false
$authSecretFromEnv = $null
foreach ($pair in (Parse-DotEnv $EnvFile)) {
  if ($pair.Key -eq 'GOOGLE_APPLICATION_CREDENTIALS') {
    $sawGoogleApplicationCredentials = $true
  }
  if ($pair.Key -eq 'AUTH_SECRET') {
    $authSecretFromEnv = $pair.Value
  }
  if (Should-IgnoreKey $pair.Key $IgnoreKeys) { continue }
  if ($pair.Key -in @('GCLOUD_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT')) {
    $projectId = $pair.Value
  }
  $value = $pair.Value -replace ',', '\,'
  $envPairs += "$($pair.Key)=$value"
}

if ($sawGoogleApplicationCredentials) {
  Write-Warning "GOOGLE_APPLICATION_CREDENTIALS is present in $EnvFile. Cloud Run should use ADC via its runtime service account; this key is ignored for deploy."
}

if ($Secrets) {
  foreach ($entry in ($Secrets -split ',')) {
    if (-not $entry -or $entry -notmatch '=') { continue }
    $key = ($entry -split '=', 2)[0].Trim()
    $value = ($entry -split '=', 2)[1].Trim()
    if ($key -and $value) {
      if ($value -notmatch ':') {
        $value = "${value}:latest"
      }
      $secretMap[$key] = $value
    }
  }
}

if ($SecretsFile -and (Test-Path -LiteralPath $SecretsFile)) {
  foreach ($pair in (Parse-DotEnv $SecretsFile)) {
    if (Should-IgnoreKey $pair.Key $IgnoreSecretKeys) { continue }
    $key = $pair.Key
    if (-not $key) { continue }
    # Name-only mapping: secret values are not read/uploaded by this script.
    $secretMap[$key] = ('{0}:latest' -f $key)
  }
}

$hasAuthSecretMapping = $secretMap.ContainsKey('AUTH_SECRET')
$hasSafeAuthSecretEnv = -not [string]::IsNullOrWhiteSpace($authSecretFromEnv) -and $authSecretFromEnv.Trim() -ne 'development-secret'
if (-not $hasAuthSecretMapping -and -not $hasSafeAuthSecretEnv) {
  Write-Error "AUTH_SECRET is required for Cloud Run configuration. Add AUTH_SECRET to server/.secrets and create a matching Secret Manager secret, or set a non-default AUTH_SECRET in the deploy env file."
  exit 1
}

$hasSecretOverrides = $secretMap.Count -gt 0

if ($secretMap.Count -gt 0) {
  $secretKeys = @($secretMap.Keys)
  foreach ($key in $secretKeys) {
    $pattern = ('^{0}=' -f [regex]::Escape($key))
    $envPairs = $envPairs | Where-Object { $_ -notmatch $pattern }
  }
}
$envArg = ($envPairs -join ',')
if ($envPairs.Count -eq 0) {
  Write-Error "No env vars parsed from $EnvFile after filtering .secrets-managed keys."
  exit 1
}
$envKeys = $envPairs | ForEach-Object { ($_ -split '=', 2)[0] } | Where-Object { $_ }

$secretsArg = ''
if ($secretMap.Count -gt 0) {
  $secretPairs = @()
  foreach ($key in @($secretMap.Keys)) {
    $value = [string]$secretMap[$key]
    if ([string]::IsNullOrWhiteSpace($value)) {
      $value = ('{0}:latest' -f $key)
    } elseif ($value -notmatch ':') {
      $value = ('{0}:latest' -f $value)
    }
    $secretPairs += ('{0}={1}' -f $key, $value)
  }
  $secretsArg = ($secretPairs -join ',')
}

if ($hasSecretOverrides) {
  $cmd = @('run', 'services', 'update', $ServiceName, '--region', $Region, '--clear-secrets')
  if ($projectId) { $cmd += @('--project', $projectId) }
  & $gcloudCommand @cmd
}

if ($envKeys.Count -gt 0) {
  $cmd = @('run', 'services', 'update', $ServiceName, '--region', $Region, '--remove-secrets', ($envKeys -join ','))
  if ($projectId) { $cmd += @('--project', $projectId) }
  & $gcloudCommand @cmd
}

$cmd = @('run', 'services', 'update', $ServiceName, '--region', $Region, '--update-env-vars', $envArg)
if ($projectId) { $cmd += @('--project', $projectId) }
if ($secretsArg) { $cmd += @('--set-secrets', $secretsArg) }
if ($secretMap.Count -gt 0) { $cmd += @('--remove-env-vars', ($secretMap.Keys -join ',')) }
$removeEnvKeys = @()
foreach ($candidate in @('FIRESTORE_EMULATOR_HOST', 'GOOGLE_APPLICATION_CREDENTIALS')) {
  if (Should-IgnoreKey $candidate $IgnoreKeys) { $removeEnvKeys += $candidate }
}
if ($removeEnvKeys.Count -gt 0) {
  $cmd += @('--remove-env-vars', ($removeEnvKeys -join ','))
}

Write-Host "Configuring Cloud Run service environment..."
Write-Host "  Service: $ServiceName"
Write-Host "  Region: $Region"
Write-Host "  Env file: $EnvFile"
Write-Host "  Env vars:"
foreach ($pair in $envPairs) { Write-Host "    $(Get-DisplayEnvPair $pair)" }
if ($SecretsFile) { Write-Host "  Secrets file: $SecretsFile" }
if ($secretsArg) { Write-Host "  Secrets mapped: $($secretMap.Count)" }
if ($secretsArg) { Write-Host "  Secrets arg: $secretsArg" }

& $gcloudCommand @cmd
