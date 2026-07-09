param(
  [switch]$DryRun,
  [string]$Reason,
  [string]$ReleaseManifest
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\deploy-common.ps1')
. (Join-Path $PSScriptRoot 'lib\require-github-actor.ps1')

if (-not $Reason -or $Reason.Length -lt 8) { Fail '-Reason is required for direct production deploy' }
Import-DeployConfig
Assert-RequiredVars @('PROD_SERVICE_NAME', 'PROD_REGION', 'PROD_HOSTING_SITE', 'PROD_DOMAIN', 'PROD_FIRESTORE_DATABASE_ID', 'PROD_RUNTIME_SERVICE_ACCOUNT', 'PROD_AI_CAPTURE_BUCKET')
if (-not $env:DEPLOY_AUDIT_API_URL) { $env:DEPLOY_AUDIT_API_URL = "$($env:PROD_DOMAIN.TrimEnd('/'))/api/internal/deploy" }
Assert-GitHubActor $DryRun.IsPresent

Write-Warning "direct production deploy bypasses test cutover. Reason: $Reason"
if (-not $ReleaseManifest) {
  $buildArgs = @()
  if ($DryRun) { $buildArgs += '-DryRun' }
  $ReleaseManifest = (& (Join-Path $PSScriptRoot 'build-release.ps1') @buildArgs).Trim()
}
& node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" $ReleaseManifest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$backendDigest = Get-JsonValue $ReleaseManifest 'backendImageDigest'
$manifestGitSha = Get-JsonValue $ReleaseManifest 'gitSha'
$workDir = Join-Path $Script:RepoRoot 'dist\deploy-prod'
Expand-FrontendFromManifest $ReleaseManifest (Join-Path $workDir 'frontend')
$hostingConfig = Join-Path $workDir 'firebase.hosting.generated.json'
New-HostingConfig -OutputFile $hostingConfig -Site $env:PROD_HOSTING_SITE -PublicDir (Join-Path $workDir 'frontend') -ServiceName $env:PROD_SERVICE_NAME -Region $env:PROD_REGION -DomainUrl $env:PROD_DOMAIN

if (-not $DryRun) {
  & gcloud run deploy $env:PROD_SERVICE_NAME `
    --image $backendDigest `
    --region $env:PROD_REGION `
    --service-account $env:PROD_RUNTIME_SERVICE_ACCOUNT `
    --update-labels "app-git-sha=$manifestGitSha" `
    --update-env-vars "WEB_URL=$($env:PROD_DOMAIN),FIRESTORE_DATABASE_ID=$($env:PROD_FIRESTORE_DATABASE_ID),AI_CAPTURE_BUCKET=$($env:PROD_AI_CAPTURE_BUCKET)"
  if ($LASTEXITCODE -ne 0) { Fail 'gcloud run deploy failed for production service' }

  Invoke-FirebaseHostingDeploy -ConfigFile $hostingConfig -Site $env:PROD_HOSTING_SITE
  & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl $env:PROD_DOMAIN -Environment 'production-direct'
  if ($LASTEXITCODE -ne 0) { Fail 'Smoke test failed after direct production deploy' }
}

$actor = if ($env:GITHUB_ACTOR) { $env:GITHUB_ACTOR } else { 'local' }
Write-LogJson -FilePath (Join-Path $Script:RepoRoot "dist\release\direct-prod-deploy-$(Get-Date -Format 'yyyyMMddHHmmss').json") -Data ([ordered]@{
  operation = 'deploy-prod'
  reason = $Reason
  actor = $actor
  releaseManifest = $ReleaseManifest
  targetService = $env:PROD_SERVICE_NAME
})
Write-DeployAuditLog -Action 'DEPLOY_DIRECT_PROD' -Reason $Reason -ReleaseManifest $ReleaseManifest -Details @{ backendImageDigest = $backendDigest }
