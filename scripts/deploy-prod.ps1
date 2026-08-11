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
Ensure-GcloudProjectId
Assert-RequiredVars @('GCLOUD_PROJECT_ID', 'PROD_SERVICE_NAME', 'PROD_REGION', 'PROD_HOSTING_SITE', 'PROD_DOMAIN', 'PROD_FIRESTORE_DATABASE_ID', 'PROD_RUNTIME_SERVICE_ACCOUNT', 'PROD_AI_CAPTURE_BUCKET')
if (-not $env:DEPLOY_AUDIT_API_URL) { $env:DEPLOY_AUDIT_API_URL = "$($env:PROD_DOMAIN.TrimEnd('/'))/api/internal/deploy" }
Assert-GitHubActor $DryRun.IsPresent

Write-Warning "direct production deploy bypasses test cutover. Reason: $Reason"
if (-not $ReleaseManifest) {
  $buildParams = @{}
  if ($DryRun) { $buildParams.DryRun = $true }
  $buildOutput = [System.Collections.Generic.List[string]]::new()
  & (Join-Path $PSScriptRoot 'build-release.ps1') @buildParams | ForEach-Object {
    Write-Host $_
    [void]$buildOutput.Add([string]$_)
  }
  $ReleaseManifest = $buildOutput | Where-Object { $_ -match 'release-manifest-[^\\/:]+\.json$' } | Select-Object -Last 1
  if (-not $ReleaseManifest -or -not (Test-Path -LiteralPath $ReleaseManifest)) {
    Fail 'Release build did not return a valid manifest path'
  }
  $ReleaseManifest = $ReleaseManifest.Trim()
}
& node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" $ReleaseManifest
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$backendDigest = Get-JsonValue $ReleaseManifest 'backendImageDigest'
$manifestGitSha = Get-JsonValue $ReleaseManifest 'gitSha'
$workDir = Join-Path $Script:RepoRoot 'dist\deploy-prod'
Expand-FrontendFromManifest $ReleaseManifest (Join-Path $workDir 'frontend')
$hostingConfig = Join-Path $workDir 'firebase.hosting.generated.json'
New-HostingConfig -OutputFile $hostingConfig -Site $env:PROD_HOSTING_SITE -PublicDir (Join-Path $workDir 'frontend') -ServiceName $env:PROD_SERVICE_NAME -Region $env:PROD_REGION -DomainUrl $env:PROD_DOMAIN
$secretDeploy = Get-CloudRunSecretDeployArgs

if (-not $DryRun) {
  & gcloud run deploy $env:PROD_SERVICE_NAME `
    --image $backendDigest `
    --region $env:PROD_REGION `
    --session-affinity `
    --max-instances 1 `
    --service-account $env:PROD_RUNTIME_SERVICE_ACCOUNT `
    --update-labels "app-git-sha=$manifestGitSha" `
    --update-env-vars "GCLOUD_PROJECT_ID=$($env:GCLOUD_PROJECT_ID),WEB_URL=$($env:PROD_DOMAIN),BACKEND_URL=$($env:PROD_DOMAIN),GOOGLE_CALLBACK_URL=$($env:PROD_DOMAIN)/api/auth/google/callback,FIRESTORE_DATABASE_ID=$($env:PROD_FIRESTORE_DATABASE_ID),AI_CAPTURE_BUCKET=$($env:PROD_AI_CAPTURE_BUCKET),DB_PROVIDER=firebase" `
    --set-secrets $secretDeploy.Argument `
    --remove-env-vars $secretDeploy.Keys
  if ($LASTEXITCODE -ne 0) { Fail 'gcloud run deploy failed for production service' }
  & gcloud run services update-traffic $env:PROD_SERVICE_NAME --region $env:PROD_REGION --to-latest
  if ($LASTEXITCODE -ne 0) { Fail 'Failed to route production traffic to the latest revision' }

  Invoke-FirebaseHostingDeploy -ConfigFile $hostingConfig -Site $env:PROD_HOSTING_SITE
  & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl $env:PROD_DOMAIN -Environment 'production-direct'
  if ($LASTEXITCODE -ne 0) { Fail 'Smoke test failed after direct production deploy' }
}

$actor = if ($env:GITHUB_ACTOR) { $env:GITHUB_ACTOR } else { 'local' }
$evidencePath = Join-Path $Script:RepoRoot "dist\release\direct-prod-deploy-$(Get-Date -Format 'yyyyMMddHHmmss').json"
Write-LogJson -FilePath $evidencePath -Data ([ordered]@{
  operation = 'deploy-prod'
  status = if ($DryRun) { 'dry-run' } else { 'completed' }
  reason = $Reason
  actor = $actor
  releaseManifest = $ReleaseManifest
  targetService = $env:PROD_SERVICE_NAME
})
if (-not $DryRun) {
  Write-DeployAuditLog -Action 'DEPLOY_DIRECT_PROD' -Reason $Reason -ReleaseManifest $ReleaseManifest -Details @{ backendImageDigest = $backendDigest }
} else {
  Write-Host 'Dry run complete; no production changes or external audit writes were made.'
}
Write-Output $evidencePath
