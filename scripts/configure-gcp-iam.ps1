param(
  [Parameter(Position = 0)]
  [string]$SecretsFile = './server/.secrets'
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) {
  Write-Host "[INFO] $Message"
}

function Write-Fail([string]$Message) {
  Write-Error "[ERROR] $Message"
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
  $vars = @{}
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
    if ($key) { $vars[$key] = $value }
  }
  return $vars
}

function Normalize-BucketName([string]$Value) {
  if (-not $Value) { return '' }
  $v = $Value.Trim()
  $v = $v -replace '^gs://', ''
  $v = $v -replace '^https?://storage.googleapis.com/', ''
  $v = ($v -split '[/?#]', 2)[0]
  return $v.Trim()
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$envFileFallback = Join-Path $repoRoot 'server/.env'

$envVars = @{}
if (Test-Path -LiteralPath $SecretsFile) {
  $envVars = Parse-DotEnv $SecretsFile
}
if (-not $envVars.ContainsKey('GCLOUD_PROJECT_ID') -and (Test-Path -LiteralPath $envFileFallback)) {
  $envVars += Parse-DotEnv $envFileFallback
}

$GCLOUD_PROJECT_ID = if ($env:GCLOUD_PROJECT_ID) { $env:GCLOUD_PROJECT_ID } else { $envVars['GCLOUD_PROJECT_ID'] }
$GCLOUD_PROJECT_NUMBER = $envVars['GCLOUD_PROJECT_NUMBER']
$DEPLOYER_SERVICE_ACCOUNT_EMAIL = $envVars['DEPLOYER_SERVICE_ACCOUNT_EMAIL']
$RUNTIME_SERVICE_ACCOUNT_EMAIL = $envVars['RUNTIME_SERVICE_ACCOUNT_EMAIL']
$LOCATION_BUCKET = if ($env:LOCATION_BUCKET) { $env:LOCATION_BUCKET } else { $envVars['LOCATION_BUCKET'] }
$FIREBASE_STORAGE_BUCKET = if ($env:FIREBASE_STORAGE_BUCKET) { $env:FIREBASE_STORAGE_BUCKET } else { $envVars['FIREBASE_STORAGE_BUCKET'] }

if (-not $GCLOUD_PROJECT_ID) { Write-Fail "GCLOUD_PROJECT_ID must be set in '$SecretsFile'." }
if (-not $GCLOUD_PROJECT_NUMBER) { Write-Fail "GCLOUD_PROJECT_NUMBER must be set in '$SecretsFile'." }
if (-not $DEPLOYER_SERVICE_ACCOUNT_EMAIL) { Write-Fail "DEPLOYER_SERVICE_ACCOUNT_EMAIL must be set in '$SecretsFile'." }

if (-not $RUNTIME_SERVICE_ACCOUNT_EMAIL) {
  $RUNTIME_SERVICE_ACCOUNT_EMAIL = "$GCLOUD_PROJECT_NUMBER-compute@developer.gserviceaccount.com"
}
$bucketRaw = if ($LOCATION_BUCKET) { $LOCATION_BUCKET } else { $FIREBASE_STORAGE_BUCKET }
$bucketName = Normalize-BucketName $bucketRaw
$CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL = "$GCLOUD_PROJECT_NUMBER@cloudbuild.gserviceaccount.com"

Write-Info "Project:                  $GCLOUD_PROJECT_ID"
Write-Info "Deployer SA (CI/CD):      $DEPLOYER_SERVICE_ACCOUNT_EMAIL"
Write-Info "Cloud Build SA (Builder): $CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL"
Write-Info "Runtime SA (Cloud Run):   $RUNTIME_SERVICE_ACCOUNT_EMAIL"
if ($bucketName) {
  Write-Info "Storage bucket:           $bucketName"
}
Write-Info "-----------------------------------------------------"

Write-Info "Granting permissions to Deployer Service Account ($DEPLOYER_SERVICE_ACCOUNT_EMAIL)..."
$deployerRoles = @(
  'roles/cloudbuild.builds.editor',
  'roles/artifactregistry.writer',
  'roles/logging.logWriter',
  'roles/secretmanager.admin'
)
foreach ($role in $deployerRoles) {
  Write-Info "  - Ensuring project role: $role"
  & gcloud projects add-iam-policy-binding $GCLOUD_PROJECT_ID `
    --member "serviceAccount:$DEPLOYER_SERVICE_ACCOUNT_EMAIL" `
    --role $role `
    --condition None | Out-Null
}

Write-Info "Granting permissions to Cloud Build Service Account ($CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL)..."
$cloudBuildRoles = @('roles/run.admin')
foreach ($role in $cloudBuildRoles) {
  Write-Info "  - Ensuring project role: $role"
  & gcloud projects add-iam-policy-binding $GCLOUD_PROJECT_ID `
    --member "serviceAccount:$CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL" `
    --role $role `
    --condition None | Out-Null
}

Write-Info "  - Ensuring Cloud Build SA can act as the Runtime SA (roles/iam.serviceAccountUser)"
& gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SERVICE_ACCOUNT_EMAIL `
  --project $GCLOUD_PROJECT_ID `
  --member "serviceAccount:$CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL" `
  --role "roles/iam.serviceAccountUser" | Out-Null

Write-Info "Granting permissions to Runtime Service Account ($RUNTIME_SERVICE_ACCOUNT_EMAIL)..."
$runtimeRoles = @(
  'roles/datastore.user',
  'roles/secretmanager.secretAccessor'
)
foreach ($role in $runtimeRoles) {
  Write-Info "  - Ensuring project role: $role"
  & gcloud projects add-iam-policy-binding $GCLOUD_PROJECT_ID `
    --member "serviceAccount:$RUNTIME_SERVICE_ACCOUNT_EMAIL" `
    --role $role `
    --condition None | Out-Null
}

if ($bucketName) {
  Write-Info "  - Ensuring bucket role: roles/storage.objectAdmin on gs://$bucketName"
  & gcloud storage buckets add-iam-policy-binding "gs://$bucketName" `
    --member "serviceAccount:$RUNTIME_SERVICE_ACCOUNT_EMAIL" `
    --role "roles/storage.objectAdmin" | Out-Null
} else {
  Write-Info "  - Skipping bucket IAM because LOCATION_BUCKET/FIREBASE_STORAGE_BUCKET is not set."
}

Write-Info "  - Ensuring Runtime SA can sign URLs (roles/iam.serviceAccountTokenCreator on itself)"
& gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SERVICE_ACCOUNT_EMAIL `
  --project $GCLOUD_PROJECT_ID `
  --member "serviceAccount:$RUNTIME_SERVICE_ACCOUNT_EMAIL" `
  --role "roles/iam.serviceAccountTokenCreator" | Out-Null

Write-Info "-----------------------------------------------------"
Write-Info "IAM configuration complete."
