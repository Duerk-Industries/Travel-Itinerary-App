$ErrorActionPreference = 'Stop'
# PowerShell 7.3+ turns ANY stderr line from a native command into a
# terminating error when $ErrorActionPreference = 'Stop' (this is
# $PSNativeCommandUseErrorActionPreference, default $true there) — regardless
# of the command's actual exit code and regardless of whether the call goes
# through gcloud.cmd or gcloud.ps1. gcloud routinely writes routine progress
# ("Building using Dockerfile and deploying container...") to stderr, so a
# fully successful `gcloud run deploy` can still abort this script with a
# NativeCommandError before $LASTEXITCODE is ever checked. Disable it here so
# native-command failure detection goes through the explicit $LASTEXITCODE
# checks this script already does after every gcloud call, not stderr content.
$PSNativeCommandUseErrorActionPreference = $false

$ServiceName = if ($env:SERVICE_NAME) { $env:SERVICE_NAME } else { 'travel-itinerary-app' }
$Region = if ($env:REGION) { $env:REGION } else { 'us-east5' }
$SourceDir = if ($env:SOURCE_DIR) { $env:SOURCE_DIR } else { 'server' }
$Memory = if ($env:MEMORY) { $env:MEMORY } else { '1Gi' }
$EnvFile = if ($env:ENV_FILE) { $env:ENV_FILE } else { '' }
$SecretsFile = if ($env:SECRETS_FILE) { $env:SECRETS_FILE } else { '' }
$Secrets = if ($env:SECRETS) { $env:SECRETS } else { '' }
$IgnoreKeys = if ($env:IGNORE_KEYS) { $env:IGNORE_KEYS } else { 'PORT,FIRESTORE_EMULATOR_HOST,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS' }
$IgnoreSecretKeys = if ($env:IGNORE_SECRET_KEYS) { $env:IGNORE_SECRET_KEYS } else { 'GCLOUD_PROJECT,GOOGLE_CLOUD_PROJECT,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS' }
$SkipFirestoreIndexes = $env:SKIP_FIRESTORE_INDEXES -eq '1'
$SkipLockfileCheck = $env:SKIP_LOCKFILE_CHECK -eq '1'
# On Windows, prefer gcloud.cmd over gcloud.ps1. The PowerShell shim can turn
# Cloud SDK progress written to stderr (for example, "Building using Dockerfile")
# into a NativeCommandError even while the deployment is still running.
$GcloudCommand = if (Get-Command gcloud.cmd -ErrorAction SilentlyContinue) { 'gcloud.cmd' } else { 'gcloud' }

# Belt-and-suspenders on top of the $PSNativeCommandUseErrorActionPreference
# setting above: that automatic variable doesn't exist before PS 7.3 and,
# per field reports, isn't reliably honored by every 7.3+ build either. When
# it isn't, a native command's routine stderr progress output (gcloud's
# "Building using Dockerfile and deploying container..." is not an error) is
# still wrapped into a terminating NativeCommandError under
# $ErrorActionPreference = 'Stop' — and it throws *before* the assignment
# completes, so callers never get a chance to check $LASTEXITCODE or inspect
# the output for real diagnostics. Every gcloud call in this script that
# merges stderr via 2>&1 goes through this wrapper instead of a bare
# `& $GcloudCommand ...`, so that on every PowerShell version, success or
# failure is decided solely by $LASTEXITCODE — never by whether gcloud wrote
# anything to stderr.
function Invoke-GcloudAllowingStderr {
  param([Parameter(Mandatory)][ScriptBlock]$ScriptBlock)
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $ScriptBlock
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

# server/ is an npm workspace member — a normal `npm install` there (or at the
# repo root) updates the *root* package-lock.json, not server/package-lock.json.
# server/Dockerfile only COPYs the server/ directory into the build context and
# runs a plain `npm ci` there, so it's server/package-lock.json specifically
# that has to be self-consistent with server/package.json — and nothing in the
# normal dev workflow touches that file, so it silently drifts (see
# docs/implementation_plans for the 2026-08-12 incident: a version bump in
# server/package.json shipped without regenerating server/package-lock.json,
# and three consecutive deploys failed at the Docker build step before this
# check existed). CI now runs this same check on every PR
# (.github/workflows/ci.yml, job "server-lockfile-sync"); this is the same
# check run locally, right before committing to a multi-minute Cloud Build,
# so drift is a several-second local failure instead of a slow, opaque one.
function Test-ServerLockfileInSync {
  param([Parameter(Mandatory)][string]$SourceDir)
  Write-Host "Verifying $SourceDir/package-lock.json matches $SourceDir/package.json (mirrors the Docker build's npm ci)..."
  $packageJsonPath = Join-Path $SourceDir 'package.json'
  $lockfilePath = Join-Path $SourceDir 'package-lock.json'
  if (-not (Test-Path -LiteralPath $packageJsonPath) -or -not (Test-Path -LiteralPath $lockfilePath)) {
    Write-Host "  Skipping: $packageJsonPath or $lockfilePath not found."
    return
  }
  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('deploy-lockfile-check-' + [System.Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  try {
    Copy-Item -LiteralPath $packageJsonPath -Destination $tempDir
    Copy-Item -LiteralPath $lockfilePath -Destination $tempDir
    Push-Location $tempDir
    try {
      $previousErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        & npm ci --no-workspaces --no-audit --no-fund --ignore-scripts *>$null
        $checkExitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $previousErrorActionPreference
      }
    } finally {
      Pop-Location
    }
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($checkExitCode -ne 0) {
    Write-Error @"
$lockfilePath is out of sync with $packageJsonPath — server/Dockerfile's `npm ci` would fail this exact way during the Cloud Build step (this is the same check that build runs).

Fix:
  cd $SourceDir
  npm install --package-lock-only --no-workspaces
  cd ..
Then commit the updated $lockfilePath and retry the deploy.

To bypass this check for one deploy: `set SKIP_LOCKFILE_CHECK=1` (cmd) or `$env:SKIP_LOCKFILE_CHECK = '1'` (PowerShell) before rerunning.
"@
    exit 1
  }
  Write-Host "  In sync."
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
    'EXPO_PUBLIC_FIREBASE_APP_ID',
    # Stripe Billing — safe to log; STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET must stay in Secret Manager
    'STRIPE_BILLING_ENABLED',
    'STRIPE_PREMIUM_PRODUCT_ID',
    'STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID',
    'STRIPE_CHECKOUT_SUCCESS_URL',
    'STRIPE_CHECKOUT_CANCEL_URL',
    'STRIPE_PORTAL_RETURN_URL',
    'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
    'STRIPE_PREMIUM_ANNUAL_PRICE_ID'
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

function Get-UniqueStrings([string[]]$Values) {
  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  $unique = @()
  foreach ($value in $Values) {
    if ([string]::IsNullOrWhiteSpace($value)) { continue }
    if ($seen.Add($value)) {
      $unique += $value
    }
  }
  return $unique
}

# gcloud's --update-env-vars/--set-secrets flags are KEY=VALUE dicts delimited
# by commas, so a literal comma inside any VALUE (e.g. ZAI_MODELS=a,b,c) breaks
# parsing unless the item delimiter itself is changed. Per `gcloud topic
# escaping`, that's done by prefixing the whole flag value with `^DELIM^` and
# joining pairs with DELIM instead of ','; there is no backslash-escape for a
# literal comma within a value. This picks a delimiter that doesn't collide
# with anything already present in the pairs being joined.
# Cloud Run health-checks every new revision on its own, so a key that's currently
# secret-bound but is about to become a plain env var (or vice versa) must never be
# split across two separate `gcloud run deploy`/`services update` calls — the revision
# created in between would have neither the secret binding nor the literal value and
# would fail to start (this bit us for real: STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET
# were dropped by a standalone --remove-secrets step, and the app hard-crashes at
# startup without them). Looking up which keys are currently secret-bound lets the
# caller fold the diff into the SAME deploy command as --update-env-vars, so the type
# transition lands atomically in one revision.
function Get-CurrentSecretBoundEnvKeys([string]$ServiceName, [string]$Region) {
  $json = & $GcloudCommand run services describe $ServiceName --region $Region --format=json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) { return @() }
  try {
    $service = ($json -join "`n") | ConvertFrom-Json
  } catch {
    return @()
  }
  $keys = @()
  foreach ($container in @($service.spec.template.spec.containers)) {
    foreach ($e in @($container.env)) {
      if ($e.valueFrom -and $e.valueFrom.secretKeyRef) {
        $keys += $e.name
      }
    }
  }
  return Get-UniqueStrings $keys
}

Write-Host "Deploying Cloud Run service source code..."
Write-Host "  Service: $ServiceName"
Write-Host "  Region: $Region"
Write-Host "  Source: $SourceDir"
Write-Host "  Memory: $Memory"

if ($SkipLockfileCheck) {
  Write-Host "Skipping package-lock.json sync check because SKIP_LOCKFILE_CHECK=1."
} else {
  Test-ServerLockfileInSync -SourceDir $SourceDir
}

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
$sawGoogleApplicationCredentials = $false
$authSecretFromEnv = $null
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
    if ($pair.Key -eq 'AUTH_SECRET') {
      $authSecretFromEnv = $pair.Value
    }
    if (Should-IgnoreKey $pair.Key $IgnoreKeys) { continue }
    $value = $pair.Value
    if ($pair.Key -eq 'AUTH_REDIRECT_URI_ALLOWLIST') {
      $value = ($value -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
      $value = ($value -join ';')
    }
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

$hasAuthSecretMapping = $secretMap.ContainsKey('AUTH_SECRET')
$hasSafeAuthSecretEnv = -not [string]::IsNullOrWhiteSpace($authSecretFromEnv) -and $authSecretFromEnv.Trim() -ne 'development-secret'
if (-not $hasAuthSecretMapping -and -not $hasSafeAuthSecretEnv) {
  Write-Error "AUTH_SECRET is required for Cloud Run deploy. Add AUTH_SECRET to server/.secrets and create a matching Secret Manager secret, or set a non-default AUTH_SECRET in the deploy env file."
  exit 1
}

if ($secretMap.Count -gt 0) {
  $secretKeys = @($secretMap.Keys)
  foreach ($key in $secretKeys) {
    $pattern = ('^{0}=' -f [regex]::Escape($key))
    $envPairs = $envPairs | Where-Object { $_ -notmatch $pattern }
  }
}
$envFlagsFile = $null
if ($envPairs.Count -gt 0) {
  # Use a gcloud flags file for environment variables. This avoids a second
  # layer of PowerShell/cmd.exe caret processing and preserves values that
  # contain commas (model lists, allowlists, etc.) exactly.
  $envFlagValues = [ordered]@{}
  foreach ($pair in $envPairs) {
    $parts = $pair -split '=', 2
    $envFlagValues[$parts[0]] = if ($parts.Count -gt 1) { $parts[1] } else { '' }
  }
  $envFlagsFile = [System.IO.Path]::GetTempFileName()
  $envFlags = [ordered]@{ '--update-env-vars' = $envFlagValues }
  $envFlags | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $envFlagsFile -Encoding utf8
  Write-Host "Env vars to upload:"
  foreach ($pair in $envPairs) { Write-Host "  $(Get-DisplayEnvPair $pair)" }
}
$secretsArg = ''
if ($secretMap.Count -gt 0) {
  $secretPairs = @()
  foreach ($key in @($secretMap.Keys)) {
    $secretPairs += ('{0}={1}' -f $key, [string]$secretMap[$key])
  }
  # Secret mappings are generated as KEY=KEY:latest and cannot contain
  # commas, so use gcloud's normal comma delimiter. The custom ^@^ delimiter
  # syntax is shell-sensitive and is stripped when invoking gcloud.cmd from
  # PowerShell, producing one invalid secret spec.
  $secretsArg = $secretPairs -join ','
  Write-Host "Secret mappings to apply (names only):"
  foreach ($key in @($secretMap.Keys)) { Write-Host "  $key -> $($secretMap[$key])" }
}

# Anything currently secret-bound on the live service that isn't in this deploy's
# secretMap needs to be dropped — most commonly a key that moved from server/.secrets
# to server/.env (or was removed from both). --set-secrets would express this as
# "replace the whole secret set," but --set-secrets and --remove-secrets are mutually
# exclusive on the same `gcloud run deploy` call, and --update-env-vars must be able to
# supply the literal replacement value in that same call (see Get-CurrentSecretBoundEnvKeys
# above for why). --update-secrets + --remove-secrets can be combined instead, giving the
# same end state atomically.
$currentSecretBoundKeys = Get-CurrentSecretBoundEnvKeys -ServiceName $ServiceName -Region $Region
$secretsToRemove = @($currentSecretBoundKeys | Where-Object { -not $secretMap.ContainsKey($_) })
if ($secretsToRemove.Count -gt 0) {
  Write-Host "Secret bindings to remove (no longer in server/.secrets):"
  foreach ($key in $secretsToRemove) { Write-Host "  $key" }
}

$cmd = @('run', 'deploy', $ServiceName, '--source', $SourceDir, '--region', $Region, '--session-affinity', '--max-instances', '1')
$cmd += @('--memory', $Memory)
if ($envFlagsFile) { $cmd += "--flags-file=$envFlagsFile" }
if ($secretsArg) { $cmd += @('--update-secrets', $secretsArg) }
if ($secretsToRemove.Count -gt 0) { $cmd += @('--remove-secrets', ($secretsToRemove -join ',')) }
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

$deployStartedAt = [DateTime]::UtcNow
try {
  $deployOutput = @(Invoke-GcloudAllowingStderr { & $GcloudCommand @cmd 2>&1 })
  $deployExitCode = $LASTEXITCODE
} finally {
  if ($envFlagsFile) {
    Remove-Item -LiteralPath $envFlagsFile -Force -ErrorAction SilentlyContinue
  }
}
$deployOutput | ForEach-Object { Write-Host $_ }

if ($deployExitCode -ne 0) {
  # `gcloud run deploy --source` often reports only "Build failed" even
  # though Cloud Build has the actionable compiler/Docker error. Surface the
  # build id and status when gcloud includes it, or find the build created by
  # this deploy as a fallback.
  $deployText = ($deployOutput | ForEach-Object { [string]$_ }) -join "`n"
  $buildMatch = [regex]::Match($deployText, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $buildId = if ($buildMatch.Success) { $buildMatch.Value } else { '' }
  if (-not $buildId) {
    $filter = "createTime>$($deployStartedAt.ToString('o'))"
    # $filter contains a literal '>' (Cloud Build's filter comparison syntax,
    # not shell redirection) with no whitespace elsewhere in the token, so
    # PowerShell passes "--filter=$filter" to the process unquoted on the
    # underlying command line. $GcloudCommand is a .cmd (batch) wrapper on
    # Windows, and cmd.exe parses redirection operators in the raw command
    # line it uses to launch a batch file *before* the batch script ever
    # runs — so that bare '>' gets read as "redirect stdout to a file named
    # 2026-...:...Z", which fails immediately with "The filename, directory
    # name, or volume label syntax is incorrect." (colons aren't valid in a
    # Windows filename). Wrapping the token in its own literal quote pair
    # forces cmd.exe to see the '>' as quoted text instead of an operator;
    # gcloud's own argument parsing strips that enclosing quote pair same as
    # any other quoted CLI argument.
    $filterArg = '"--filter=' + $filter + '"'
    # `gcloud run deploy --source` submits the build to the same region as the
    # Cloud Run service (regional Cloud Build workers, not the classic global
    # pool) — an unqualified `builds list`/`builds describe` queries the
    # global pool instead, finds nothing, and this fallback silently returns
    # no build id even though the build clearly exists. --region must match
    # the deploy's own --region.
    $recentBuildOutput = @(& $GcloudCommand builds list '--region' $Region $filterArg '--limit=1' '--format=value(id)' 2>$null)
    if ($recentBuildOutput.Count -gt 0) { $buildId = ([string]$recentBuildOutput[0]).Trim() }
  }
  if ($buildId) {
    Write-Host "Cloud Build: $buildId"
    Invoke-GcloudAllowingStderr { & $GcloudCommand builds describe $buildId '--region' $Region '--format=yaml(status,logUrl,failureInfo)' 2>&1 } | ForEach-Object { Write-Host $_ }
    Write-Error "API deployment failed with gcloud exit code $deployExitCode. Cloud Build: $buildId"
  } else {
    Write-Error "API deployment failed with gcloud exit code $deployExitCode. No Cloud Build ID was returned; rerun with gcloud verbosity or inspect Cloud Build history."
  }
  exit $deployExitCode
}

# A prior --no-traffic canary deploy pins traffic away from LATEST until it is
# explicitly restored; a subsequent gcloud run deploy does not undo that.
Invoke-GcloudAllowingStderr { & $GcloudCommand run services update-traffic $ServiceName --region $Region --to-latest 2>&1 } | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
  Write-Error "API deployed, but routing traffic to the latest revision failed with gcloud exit code $LASTEXITCODE."
  exit $LASTEXITCODE
}

Write-Host "API deployment completed."
