$ErrorActionPreference = 'Stop'

$ServiceName = if ($env:SERVICE_NAME) { $env:SERVICE_NAME } else { 'travel-itinerary-app' }
$Region = if ($env:REGION) { $env:REGION } else { 'us-east5' }
$SourceDir = if ($env:SOURCE_DIR) { $env:SOURCE_DIR } else { 'server' }
$EnvFile = if ($env:ENV_FILE) { $env:ENV_FILE } else { '' }
$SecretsFile = if ($env:SECRETS_FILE) { $env:SECRETS_FILE } else { '' }
$Secrets = if ($env:SECRETS) { $env:SECRETS } else { '' }
$IgnoreKeys = if ($env:IGNORE_KEYS) { $env:IGNORE_KEYS } else { 'PORT,FIRESTORE_EMULATOR_HOST,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS' }
$IgnoreSecretKeys = if ($env:IGNORE_SECRET_KEYS) { $env:IGNORE_SECRET_KEYS } else { 'GCLOUD_PROJECT,GOOGLE_CLOUD_PROJECT,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS' }
$SkipFirestoreIndexes = $env:SKIP_FIRESTORE_INDEXES -eq '1'

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
$sawGoogleApplicationCredentials = $false
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
    if ($pair.Key -eq 'GOOGLE_APPLICATION_CREDENTIALS') {
      $sawGoogleApplicationCredentials = $true
    }
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
if ($Secrets) {
  foreach ($entry in ($Secrets -split ',')) {
    if (-not $entry -or $entry -notmatch '=') { continue }
    $key = ($entry -split '=', 2)[0].Trim()
    $value = ($entry -split '=', 2)[1].Trim()
    if (-not $key -or -not $value) { continue }
    if ($value -notmatch ':') { $value = "${value}:latest" }
    $secretMap[$key] = $value
  }
}
if ($sawGoogleApplicationCredentials) {
  Write-Warning "GOOGLE_APPLICATION_CREDENTIALS is present in $EnvFile. Cloud Run should use ADC via its runtime service account; this key is ignored for deploy."
}
if ($SecretsFile -and (Test-Path -LiteralPath $SecretsFile)) {
  foreach ($pair in (Parse-DotEnv $SecretsFile)) {
    if (Should-IgnoreKey $pair.Key $IgnoreSecretKeys) { continue }
    if (-not [string]::IsNullOrWhiteSpace($pair.Key)) {
      # Name-only mapping: Cloud Run reads latest Secret Manager version.
      $secretMap[$pair.Key] = "$($pair.Key):latest"
    }
  }
}
if ($secretMap.Count -gt 0) {
  $secretKeys = @($secretMap.Keys)
  foreach ($key in $secretKeys) {
    $pattern = ('^{0}=' -f [regex]::Escape($key))
    $envPairs = $envPairs | Where-Object { $_ -notmatch $pattern }
  }
}
$envKeys = $envPairs | ForEach-Object { ($_ -split '=', 2)[0] } | Where-Object { $_ }

$envArg = ''
if ($envPairs.Count -gt 0) {
  $envArg = ($envPairs -join ',')
  Write-Host "Env vars to upload:"
  foreach ($pair in $envPairs) { Write-Host "  $(Get-DisplayEnvPair $pair)" }
}
$secretsArg = ''
if ($secretMap.Count -gt 0) {
  $secretPairs = @()
  foreach ($key in @($secretMap.Keys)) {
    $secretPairs += ('{0}={1}' -f $key, [string]$secretMap[$key])
  }
  $secretsArg = ($secretPairs -join ',')
  Write-Host "Secret mappings to apply (names only):"
  foreach ($key in @($secretMap.Keys)) { Write-Host "  $key -> $($secretMap[$key])" }
}

$cmd = @('run', 'deploy', $ServiceName, '--source', $SourceDir, '--region', $Region)
if ($envArg) { $cmd += @('--update-env-vars', $envArg) }
if ($secretsArg) { $cmd += @('--set-secrets', $secretsArg) }
if ($secretMap.Count -gt 0) { $cmd += @('--remove-env-vars', ($secretMap.Keys -join ',')) }
$removeEnvKeys = @()
foreach ($candidate in @('FIRESTORE_EMULATOR_HOST', 'GOOGLE_APPLICATION_CREDENTIALS')) {
  if (Should-IgnoreKey $candidate $IgnoreKeys) { $removeEnvKeys += $candidate }
}
if ($removeEnvKeys.Count -gt 0) { $cmd += @('--remove-env-vars', ($removeEnvKeys -join ',')) }

if (-not $SkipFirestoreIndexes) {
  $indexScript = Join-Path $PSScriptRoot 'deploy-firestore-indexes.ps1'
  if (-not (Test-Path -LiteralPath $indexScript)) {
    Write-Error "Expected Firestore index deploy script not found: $indexScript"
    exit 1
  }
  & $indexScript
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Firestore index deployment failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
  }
} else {
  Write-Host "Skipping Firestore index deployment because SKIP_FIRESTORE_INDEXES=1."
}

if ($envKeys.Count -gt 0) {
  Write-Host "Removing legacy secret bindings for .env-managed keys..."
  $migrateCmd = @('run', 'services', 'update', $ServiceName, '--region', $Region, '--remove-secrets', ($envKeys -join ','))
  & gcloud @migrateCmd
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Legacy secret removal failed with gcloud exit code $LASTEXITCODE."
    exit $LASTEXITCODE
  }
}

& gcloud @cmd

if ($LASTEXITCODE -ne 0) {
  Write-Error "API deployment failed with gcloud exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}

Write-Host "API deployment completed."
