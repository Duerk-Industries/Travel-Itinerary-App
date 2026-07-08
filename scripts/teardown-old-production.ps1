param(
  [switch]$DryRun,
  [string]$ConfirmDelete
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\deploy-common.ps1')
. (Join-Path $PSScriptRoot 'lib\require-github-actor.ps1')

if ($ConfirmDelete -ne 'yes-delete') { Fail '-ConfirmDelete yes-delete is required' }
Import-DeployConfig
Assert-RequiredVars @('PROD_SERVICE_NAME', 'PROD_REGION', 'PROD_DOMAIN', 'ROLLBACK_RETENTION_DAYS')
if (-not $env:DEPLOY_AUDIT_API_URL) { $env:DEPLOY_AUDIT_API_URL = "$($env:PROD_DOMAIN.TrimEnd('/'))/api/internal/deploy" }
Assert-GitHubActor $DryRun.IsPresent

if ($DryRun) {
  Write-Host "Dry run: would delete 0%-traffic revisions older than $($env:ROLLBACK_RETENTION_DAYS) days for $($env:PROD_SERVICE_NAME)"
  exit 0
}

$serviceJson = & gcloud run services describe $env:PROD_SERVICE_NAME --region $env:PROD_REGION --format=json
if ($LASTEXITCODE -ne 0) { Fail 'Failed to describe production service' }
$service = $serviceJson | ConvertFrom-Json
$cutoff = (Get-Date).ToUniversalTime().AddDays(-[double]$env:ROLLBACK_RETENTION_DAYS)

$revisionsRaw = & gcloud run revisions list --service $env:PROD_SERVICE_NAME --region $env:PROD_REGION `
  --format='value(metadata.name,status.conditions[0].lastTransitionTime)'
if ($LASTEXITCODE -ne 0) { Fail 'Failed to list revisions' }

$deleted = @()
foreach ($row in $revisionsRaw) {
  if (-not $row) { continue }
  $parts = $row -split "`t", 2
  $revision = $parts[0]
  $lastTransition = if ($parts.Length -gt 1) { $parts[1] } else { '' }

  $trafficEntry = $service.status.traffic | Where-Object { $_.revisionName -eq $revision } | Select-Object -First 1
  $traffic = if ($trafficEntry) { $trafficEntry.percent } else { 0 }
  if ($traffic -ne 0 -and $null -ne $traffic) {
    Write-Host "Skipping $revision because traffic=$traffic"
    continue
  }

  $revisionDate = $null
  if ($lastTransition) { [void][DateTime]::TryParse($lastTransition, [ref]$revisionDate) }
  if (-not $revisionDate -or $revisionDate -gt $cutoff) {
    Write-Host "Skipping $revision because it is younger than $($env:ROLLBACK_RETENTION_DAYS) days (lastTransitionTime=$lastTransition)"
    continue
  }

  & gcloud run revisions delete $revision --region $env:PROD_REGION --quiet
  if ($LASTEXITCODE -ne 0) { Fail "Failed to delete revision $revision" }
  $deleted += $revision
}

Write-DeployAuditLog -Action 'DEPLOY_TEARDOWN' -Reason "Teardown of 0%-traffic revisions older than $($env:ROLLBACK_RETENTION_DAYS) days" -ReleaseManifest '' -Details @{ service = $env:PROD_SERVICE_NAME; deletedRevisions = $deleted }
