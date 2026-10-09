<#
.SYNOPSIS
Configures a developer machine to upload trip-blog media to the shared GCS bucket.

.DESCRIPTION
The API creates signed upload URLs as the Cloud Run runtime service account. This script
updates server/.env with BLOG_MEDIA_BUCKET, lets the current developer impersonate that
service account, and creates local Application Default Credentials using that impersonation.

Run from PowerShell:
  .\scripts\setup-local-blog-media.ps1

The caller needs permission to update IAM policy on the runtime service account. It is safe
to run repeatedly. Restart `npm run dev` in server/ after it completes.
#>
[CmdletBinding()]
param(
  [string]$ProjectId = 'travel-itinerary-app-483623',
  [string]$Bucket = 'travel-itinerary-app-blog-serving-483623',
  [string]$RuntimeServiceAccount = 'travel-itinerary-app-sa@travel-itinerary-app-483623.iam.gserviceaccount.com',
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\server\.env')
)

$ErrorActionPreference = 'Stop'
$gcloud = if (Get-Command gcloud.cmd -ErrorAction SilentlyContinue) { 'gcloud.cmd' } else { 'gcloud' }

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Expected local environment file at $EnvFile. Create server/.env first."
}

$developerEmail = (& $gcloud config get-value account 2>$null).Trim()
if (-not $developerEmail -or $developerEmail -eq '(unset)') {
  throw 'No active Google Cloud account. Run `gcloud auth login` and rerun this script.'
}

Write-Host "Granting $developerEmail permission to impersonate $RuntimeServiceAccount..."
& $gcloud iam service-accounts add-iam-policy-binding $RuntimeServiceAccount `
  --project $ProjectId `
  --member "user:$developerEmail" `
  --role 'roles/iam.serviceAccountTokenCreator'
if ($LASTEXITCODE -ne 0) { throw 'Unable to grant service-account impersonation permission.' }

$envLines = Get-Content -LiteralPath $EnvFile
$bucketLine = "BLOG_MEDIA_BUCKET=$Bucket"
if ($envLines -match '^BLOG_MEDIA_BUCKET=') {
  $envLines = $envLines | ForEach-Object { if ($_ -match '^BLOG_MEDIA_BUCKET=') { $bucketLine } else { $_ } }
} else {
  $envLines += $bucketLine
}
Set-Content -LiteralPath $EnvFile -Value $envLines
Write-Host "Set BLOG_MEDIA_BUCKET=$Bucket in $EnvFile"

Write-Host 'Opening browser sign-in for local Application Default Credentials...'
& $gcloud auth application-default login --impersonate-service-account $RuntimeServiceAccount
if ($LASTEXITCODE -ne 0) { throw 'Unable to create impersonated Application Default Credentials.' }

Write-Host ''
Write-Host 'Local trip-blog media setup is complete.' -ForegroundColor Green
Write-Host 'Restart the backend: cd server; npm run dev'
