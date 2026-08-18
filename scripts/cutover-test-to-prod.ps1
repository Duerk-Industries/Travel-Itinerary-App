param(
  [switch]$DryRun,
  [string]$ReleaseManifest,
  [string]$TestEvidence,
  [switch]$Staged
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\deploy-common.ps1')
. (Join-Path $PSScriptRoot 'lib\require-github-actor.ps1')

if (-not $ReleaseManifest) { Fail '-ReleaseManifest is required' }
if (-not $TestEvidence) { Fail '-TestEvidence is required' }
Import-DeployConfig
Ensure-GcloudProjectId
Assert-RequiredVars @(
  'GCLOUD_PROJECT_ID', 'TEST_SERVICE_NAME', 'TEST_REGION', 'TEST_DOMAIN', 'PROD_SERVICE_NAME', 'PROD_REGION', 'PROD_HOSTING_SITE',
  'PROD_DOMAIN', 'PROD_RUNTIME_SERVICE_ACCOUNT', 'PROD_FIRESTORE_DATABASE_ID', 'PROD_AI_CAPTURE_BUCKET'
)
if (-not $env:DEPLOY_AUDIT_API_URL) { $env:DEPLOY_AUDIT_API_URL = "$($env:PROD_DOMAIN.TrimEnd('/'))/api/internal/deploy" }
Assert-GitHubActor $DryRun.IsPresent

& node -e "const v=require('./scripts/lib/phase11-validators'); const m=v.readJson(process.argv[1]); const e=v.readJson(process.argv[2]); v.validateReleaseManifest(m); v.validateTestEvidence(m,e);" $ReleaseManifest $TestEvidence
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$backendDigest = Get-JsonValue $ReleaseManifest 'backendImageDigest'
$manifestGitSha = Get-JsonValue $ReleaseManifest 'gitSha'
$manifestConfigFingerprint = Get-JsonValue $ReleaseManifest 'configFingerprint'

# Cutover-time live-infrastructure verification (Chapter 16 §5.4 step 1).
# validateTestEvidence above only checks the manifest and evidence JSON
# files are internally consistent with each other -- it does not prove the
# artifacts were actually live in test. These checks close that gap.
if (-not $DryRun) {
  $liveTestImage = Get-LiveServiceImage -Service $env:TEST_SERVICE_NAME -Region $env:TEST_REGION
  if ($liveTestImage -notlike "*$backendDigest*") {
    Fail "Cutover refused: image currently deployed to $($env:TEST_SERVICE_NAME) ($liveTestImage) does not match the manifest's backendImageDigest ($backendDigest)."
  }

  try {
    $testMarkerJson = Invoke-RestMethod -Uri "$($env:TEST_DOMAIN.TrimEnd('/'))/deploy-marker.json" -Method Get
  } catch {
    Fail "Cutover refused: could not fetch deploy-marker.json from $($env:TEST_DOMAIN) to verify the live test frontend artifact."
  }
  $testMarkerGitSha = $testMarkerJson.gitSha
  if ($testMarkerGitSha -ne $manifestGitSha) {
    Fail "Cutover refused: frontend artifact live at $($env:TEST_DOMAIN) (gitSha=$testMarkerGitSha) does not match the manifest being promoted (gitSha=$manifestGitSha)."
  }
}

$liveConfigFingerprint = Get-ConfigFingerprint
if ($liveConfigFingerprint -ne $manifestConfigFingerprint) {
  Fail 'Cutover refused: configFingerprint drift between the manifest and the deploy config cutover is about to use. Rebuild before promoting.'
}

$workDir = Join-Path $Script:RepoRoot 'dist\cutover-prod'
Expand-FrontendFromManifest $ReleaseManifest (Join-Path $workDir 'frontend')
$hostingConfig = Join-Path $workDir 'firebase.hosting.generated.json'
New-HostingConfig -OutputFile $hostingConfig -Site $env:PROD_HOSTING_SITE -PublicDir (Join-Path $workDir 'frontend') -ServiceName $env:PROD_SERVICE_NAME -Region $env:PROD_REGION -DomainUrl $env:PROD_DOMAIN
$secretDeploy = Get-CloudRunSecretDeployArgs

$canaryTripId = $null

# Runs on every exit path (success, smoke-test failure, or script error) so
# the canary account's data footprint never grows across cutovers
# (Chapter 16 §6) -- cleanup must not depend on the cutover having gone well.
try {
  if (-not $DryRun) {
    & gcloud run deploy $env:PROD_SERVICE_NAME --image $backendDigest --region $env:PROD_REGION --no-traffic --tag candidate --memory 2Gi --cpu 1 --session-affinity --max-instances 1 `
      --service-account $env:PROD_RUNTIME_SERVICE_ACCOUNT --update-labels "app-git-sha=$manifestGitSha" `
      --update-env-vars "GCLOUD_PROJECT_ID=$($env:GCLOUD_PROJECT_ID),WEB_URL=$($env:PROD_DOMAIN),BACKEND_URL=$($env:PROD_DOMAIN),GOOGLE_CALLBACK_URL=$($env:PROD_DOMAIN)/api/auth/google/callback,APPLE_CALLBACK_URL=$($env:PROD_DOMAIN)/api/auth/apple/callback,FIRESTORE_DATABASE_ID=$($env:PROD_FIRESTORE_DATABASE_ID),AI_CAPTURE_BUCKET=$($env:PROD_AI_CAPTURE_BUCKET),DB_PROVIDER=firebase,GIT_SHA=$manifestGitSha,NODE_OPTIONS=--max-old-space-size=1536" `
      --set-secrets $secretDeploy.Argument `
      --remove-env-vars $secretDeploy.Keys
    if ($LASTEXITCODE -ne 0) { Fail 'Failed to deploy candidate revision' }

    $candidateUrl = Get-TaggedRevisionUrl -Service $env:PROD_SERVICE_NAME -Region $env:PROD_REGION -Tag 'candidate'

    if ($env:DEPLOY_WORKER_SHARED_SECRET) {
      try {
        $writeBody = @{ cutoverLabel = $manifestGitSha } | ConvertTo-Json
        $canaryWriteResponse = Invoke-RestMethod -Method Post -Uri "$($candidateUrl.TrimEnd('/'))/api/internal/deploy/canary-smoke-write" `
          -Headers @{ 'X-Deploy-Worker-Secret' = $env:DEPLOY_WORKER_SHARED_SECRET } -ContentType 'application/json' -Body $writeBody
        $canaryTripId = $canaryWriteResponse.tripId
      } catch {
        Fail 'Cutover refused: canary smoke write against the candidate revision failed.'
      }
    } else {
      Write-Warning 'DEPLOY_WORKER_SHARED_SECRET not set; skipping canary write/cleanup (Chapter 16 §5.4 step 3).'
    }

    # Tests the candidate revision itself (via its own tagged URL) against
    # production's real database, before it receives any public traffic --
    # smoke-testing PROD_DOMAIN here would only re-test the outgoing revision.
    & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl $candidateUrl -Environment 'prod-candidate'
    if ($LASTEXITCODE -ne 0) { Fail 'Smoke test failed against candidate revision' }

    if ($Staged) {
      foreach ($pct in 10, 50, 100) {
        & gcloud run services update-traffic $env:PROD_SERVICE_NAME --region $env:PROD_REGION --to-tags "candidate=$pct"
        if ($LASTEXITCODE -ne 0) { Fail "Failed to shift traffic to $pct%" }
      }
    } else {
      & gcloud run services update-traffic $env:PROD_SERVICE_NAME --region $env:PROD_REGION --to-tags 'candidate=100'
      if ($LASTEXITCODE -ne 0) { Fail 'Failed to shift traffic to candidate' }
    }

    Invoke-FirebaseHostingDeploy -ConfigFile $hostingConfig -Site $env:PROD_HOSTING_SITE
    & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl $env:PROD_DOMAIN -Environment 'production'
    if ($LASTEXITCODE -ne 0) { Fail 'Smoke test failed against public production domain' }
  }

  $actor = if ($env:GITHUB_ACTOR) { $env:GITHUB_ACTOR } else { 'local' }
  Write-LogJson -FilePath (Join-Path $Script:RepoRoot "dist\release\cutover-$(Get-Date -Format 'yyyyMMddHHmmss').json") -Data ([ordered]@{
    operation = 'cutover'
    actor = $actor
    releaseManifest = $ReleaseManifest
    testEvidence = $TestEvidence
    backendImageDigest = $backendDigest
  })
  Write-DeployAuditLog -Action 'DEPLOY_CUTOVER' -Reason "Promotion of $manifestGitSha from test to production" -ReleaseManifest $ReleaseManifest -Details @{ backendImageDigest = $backendDigest; staged = $Staged.IsPresent }
} finally {
  if ($canaryTripId -and $env:DEPLOY_AUDIT_API_URL -and $env:DEPLOY_WORKER_SHARED_SECRET) {
    try {
      $cleanupBody = @{ tripIds = @($canaryTripId) } | ConvertTo-Json
      Invoke-RestMethod -Method Post -Uri "$($env:DEPLOY_AUDIT_API_URL)/canary-smoke-cleanup" `
        -Headers @{ 'X-Deploy-Worker-Secret' = $env:DEPLOY_WORKER_SHARED_SECRET } -ContentType 'application/json' -Body $cleanupBody | Out-Null
    } catch {
      Write-Warning "canary smoke cleanup request failed for trip=$canaryTripId : $($_.Exception.Message)"
    }
  }
}
