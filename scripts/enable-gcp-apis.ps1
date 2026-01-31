$ErrorActionPreference = 'Stop'

Write-Host "Enabling required Google Cloud services..."

$services = @(
  'run.googleapis.com',
  'secretmanager.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'firestore.googleapis.com'
)

& gcloud services enable @services

Write-Host "All required services enabled."
