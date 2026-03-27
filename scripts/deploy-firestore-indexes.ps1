$ErrorActionPreference = 'Stop'

$ProjectId = if ($env:GCLOUD_PROJECT_ID) {
  $env:GCLOUD_PROJECT_ID
} elseif ($env:GOOGLE_CLOUD_PROJECT) {
  $env:GOOGLE_CLOUD_PROJECT
} elseif ($env:GCLOUD_PROJECT) {
  $env:GCLOUD_PROJECT
} else {
  ''
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$IndexesFile = Join-Path $RepoRoot 'firestore.indexes.json'

if (-not (Test-Path -LiteralPath $IndexesFile)) {
  Write-Error "Firestore indexes file not found: $IndexesFile"
  exit 1
}

Write-Host "Deploying Firestore indexes..."
Write-Host "  Indexes: $IndexesFile"
if ($ProjectId) {
  Write-Host "  Project: $ProjectId"
}

Push-Location $RepoRoot
try {
  $cmd = @('firebase-tools', 'deploy', '--only', 'firestore:indexes')
  if ($ProjectId) {
    $cmd += @('--project', $ProjectId)
  }
  & npx @cmd
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Firestore index deployment failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

Write-Host "Firestore index deployment completed."
