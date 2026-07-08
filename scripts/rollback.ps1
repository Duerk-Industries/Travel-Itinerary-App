param(
  [switch]$DryRun,
  [string]$ReleaseManifest,
  [string]$Revision
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\deploy-common.ps1')
. (Join-Path $PSScriptRoot 'lib\require-github-actor.ps1')

if (-not $ReleaseManifest) { Fail '-ReleaseManifest is required so frontend/backend rollback remains paired' }
if (-not $Revision) { Fail '-Revision is required' }
Import-DeployConfig
Assert-RequiredVars @('PROD_SERVICE_NAME', 'PROD_REGION', 'PROD_HOSTING_SITE', 'PROD_DOMAIN')
if (-not $env:DEPLOY_AUDIT_API_URL) { $env:DEPLOY_AUDIT_API_URL = "$($env:PROD_DOMAIN.TrimEnd('/'))/api/internal/deploy" }
Assert-GitHubActor $DryRun.IsPresent

& node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" $ReleaseManifest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$manifestBackendDigest = Get-JsonValue $ReleaseManifest 'backendImageDigest'

# Refuse to pair a frontend artifact with a backend revision it was never
# actually built/tested with (Chapter 16 §5.5) -- without this check, a
# mistyped -Revision would still "succeed," silently recreating the
# version-mismatch risk this unified script exists to prevent.
if (-not $DryRun) {
  $revisionImage = (& gcloud run revisions describe $Revision --region $env:PROD_REGION --format='value(spec.containers[0].image)').Trim()
  if ($LASTEXITCODE -ne 0) { Fail "Failed to describe revision $Revision" }
  if ($revisionImage -notlike "*$manifestBackendDigest*") {
    Fail "Rollback refused: revision $Revision is running image $revisionImage, which does not match -ReleaseManifest's backendImageDigest ($manifestBackendDigest)."
  }
}

$workDir = Join-Path $Script:RepoRoot 'dist\rollback-frontend'
Expand-FrontendFromManifest $ReleaseManifest (Join-Path $workDir 'frontend')
$hostingConfig = Join-Path $workDir 'firebase.hosting.generated.json'
New-HostingConfig -OutputFile $hostingConfig -Site $env:PROD_HOSTING_SITE -PublicDir (Join-Path $workDir 'frontend') -ServiceName $env:PROD_SERVICE_NAME -Region $env:PROD_REGION -DomainUrl $env:PROD_DOMAIN

if (-not $DryRun) {
  & gcloud run services update-traffic $env:PROD_SERVICE_NAME --region $env:PROD_REGION --to-revisions "$Revision=100"
  if ($LASTEXITCODE -ne 0) { Fail 'Failed to shift traffic to rollback revision' }
  Invoke-FirebaseHostingDeploy -ConfigFile $hostingConfig -Site $env:PROD_HOSTING_SITE
  & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl $env:PROD_DOMAIN -Environment 'production-rollback'
  if ($LASTEXITCODE -ne 0) { Fail 'Smoke test failed after rollback' }
}

$actor = if ($env:GITHUB_ACTOR) { $env:GITHUB_ACTOR } else { 'local' }
Write-LogJson -FilePath (Join-Path $Script:RepoRoot "dist\release\rollback-$(Get-Date -Format 'yyyyMMddHHmmss').json") -Data ([ordered]@{
  operation = 'rollback'
  actor = $actor
  releaseManifest = $ReleaseManifest
  revision = $Revision
})
Write-DeployAuditLog -Action 'DEPLOY_ROLLBACK' -Reason "Rollback to revision $Revision" -ReleaseManifest $ReleaseManifest -Details @{ revision = $Revision }
