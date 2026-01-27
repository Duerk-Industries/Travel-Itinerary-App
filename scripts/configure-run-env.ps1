param(
  [Parameter(Position = 0)]
  [string]$EnvFile = ''
)

$ErrorActionPreference = 'Stop'

$ServiceName = if ($env:SERVICE_NAME) { $env:SERVICE_NAME } else { 'travel-itinerary-app' }
$Region = if ($env:REGION) { $env:REGION } else { 'us-east5' }
$IgnoreKeys = if ($env:IGNORE_KEYS) { $env:IGNORE_KEYS } else { 'PORT,FIRESTORE_EMULATOR_HOST,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,FIRESTORE_DATABASE_ID' }
$IgnoreSecretKeys = if ($env:IGNORE_SECRET_KEYS) { $env:IGNORE_SECRET_KEYS } else { 'GCLOUD_PROJECT,GOOGLE_CLOUD_PROJECT,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL' }
$SecretsFile = if ($env:SECRETS_FILE) { $env:SECRETS_FILE } else { '' }
$Secrets = if ($env:SECRETS) { $env:SECRETS } else { '' }
$gcloudCommand = if (Get-Command gcloud.cmd -ErrorAction SilentlyContinue) { 'gcloud.cmd' } else { 'gcloud' }

function Usage {
  Write-Error "Usage: $PSCommandPath [path/to/.env]"
  Write-Error "Configures Cloud Run env vars and Secret Manager mappings without deploying code."
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

$envPairs = @()
$projectId = ''
foreach ($pair in (Parse-DotEnv $EnvFile)) {
  if (Should-IgnoreKey $pair.Key $IgnoreKeys) { continue }
  if ($pair.Key -in @('GCLOUD_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT')) {
    $projectId = $pair.Value
  }
  $value = $pair.Value -replace ',', '\,'
  $envPairs += "$($pair.Key)=$value"
}

if ($envPairs.Count -eq 0) {
  Write-Error "No env vars parsed from $EnvFile."
  exit 1
}

$envArg = ($envPairs -join ',')

$secretMap = @{}
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
  $secretsFromFile = @()
  foreach ($pair in (Parse-DotEnv $SecretsFile)) {
    if (Should-IgnoreKey $pair.Key $IgnoreSecretKeys) { continue }
    $key = $pair.Key
    $value = $pair.Value
    if (-not $key) { continue }
    $describeArgs = @('secrets', 'describe', $key)
    if ($projectId) { $describeArgs += @('--project', $projectId) }
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $gcloudCommand @describeArgs 2>$null | Out-Null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevErrorAction
    if ($exitCode -ne 0) {
      $createArgs = @('secrets', 'create', $key, '--replication-policy=automatic')
      if ($projectId) { $createArgs += @('--project', $projectId) }
      & $gcloudCommand @createArgs
    }
    $value | & $gcloudCommand secrets versions add $key --data-file=-
    $secretsFromFile += $key
  }
  foreach ($key in $secretsFromFile | Select-Object -Unique) {
    $secretMap[$key] = ('{0}:latest' -f $key)
  }
}

$hasSecretOverrides = $secretMap.Count -gt 0

if ($secretMap.Count -gt 0) {
  $secretKeys = @($secretMap.Keys)
  foreach ($key in $secretKeys) {
    $pattern = ('^{0}=' -f [regex]::Escape($key))
    $envPairs = $envPairs | Where-Object { $_ -notmatch $pattern }
  }
}

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

$cmd = @('run', 'services', 'update', $ServiceName, '--region', $Region, '--update-env-vars', $envArg)
if ($projectId) { $cmd += @('--project', $projectId) }
if ($secretsArg) { $cmd += @('--set-secrets', $secretsArg) }
if (Should-IgnoreKey 'FIRESTORE_EMULATOR_HOST' $IgnoreKeys) { $cmd += @('--remove-env-vars', 'FIRESTORE_EMULATOR_HOST') }
if ($secretMap.Count -gt 0) { $cmd += @('--remove-env-vars', ($secretMap.Keys -join ',')) }

Write-Host "Configuring Cloud Run service environment..."
Write-Host "  Service: $ServiceName"
Write-Host "  Region: $Region"
Write-Host "  Env file: $EnvFile"
if ($SecretsFile) { Write-Host "  Secrets file: $SecretsFile" }
if ($secretsArg) { Write-Host "  Secrets mapped: $($secretMap.Count)" }
if ($secretsArg) { Write-Host "  Secrets arg: $secretsArg" }

& $gcloudCommand @cmd
