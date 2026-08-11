param(
  [switch]$DryRun,
  [switch]$Reseed,
  [string]$ReleaseManifest
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\deploy-common.ps1')
Import-DeployConfig
Ensure-GcloudProjectId
Assert-RequiredVars @(
  'GCLOUD_PROJECT_ID', 'TEST_SERVICE_NAME', 'TEST_REGION', 'TEST_HOSTING_SITE', 'TEST_DOMAIN', 'TEST_FIRESTORE_DATABASE_ID',
  'TEST_RUNTIME_SERVICE_ACCOUNT', 'TEST_AI_CAPTURE_BUCKET', 'PROD_FIRESTORE_DATABASE_ID', 'PROD_AI_CAPTURE_BUCKET'
)
& node -e "const v=require('./scripts/lib/phase11-validators'); v.assertEnvironmentIsolation(process.env);"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

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
$frontendSha = Get-JsonValue $ReleaseManifest 'frontendSha256'
$manifestConfigFingerprint = Get-JsonValue $ReleaseManifest 'configFingerprint'
$manifestGitSha = Get-JsonValue $ReleaseManifest 'gitSha'

# Recompute the fingerprint from the config actually loaded for *this*
# deploy, rather than trusting the manifest's own value -- otherwise the
# check that's supposed to catch "this build assumes config that isn't live
# yet" (Chapter 16 §5.1) can never fail, because it would just compare the
# manifest to itself.
$liveConfigFingerprint = Get-ConfigFingerprint
if ($liveConfigFingerprint -ne $manifestConfigFingerprint) {
  Fail 'Config fingerprint drift: manifest was built against different deploy config than scripts/deploy.config currently loaded. Rebuild the manifest before deploying to test.'
}

$workDir = Join-Path $Script:RepoRoot 'dist\deploy-test'
Expand-FrontendFromManifest $ReleaseManifest (Join-Path $workDir 'frontend')
$hostingConfig = Join-Path $workDir 'firebase.hosting.generated.json'
New-HostingConfig -OutputFile $hostingConfig -Site $env:TEST_HOSTING_SITE -PublicDir (Join-Path $workDir 'frontend') -ServiceName $env:TEST_SERVICE_NAME -Region $env:TEST_REGION -DomainUrl $env:TEST_DOMAIN
$secretDeploy = Get-CloudRunSecretDeployArgs

if (-not $DryRun) {
  & gcloud run deploy $env:TEST_SERVICE_NAME `
    --image $backendDigest `
    --region $env:TEST_REGION `
    --session-affinity `
    --max-instances 1 `
    --service-account $env:TEST_RUNTIME_SERVICE_ACCOUNT `
    --update-labels "app-git-sha=$manifestGitSha" `
    --update-env-vars "GCLOUD_PROJECT_ID=$($env:GCLOUD_PROJECT_ID),WEB_URL=$($env:TEST_DOMAIN),BACKEND_URL=$($env:TEST_DOMAIN),GOOGLE_CALLBACK_URL=$($env:TEST_DOMAIN)/api/auth/google/callback,FIRESTORE_DATABASE_ID=$($env:TEST_FIRESTORE_DATABASE_ID),AI_CAPTURE_BUCKET=$($env:TEST_AI_CAPTURE_BUCKET),DB_PROVIDER=firebase" `
    --set-secrets $secretDeploy.Argument `
    --remove-env-vars $secretDeploy.Keys
  if ($LASTEXITCODE -ne 0) { Fail 'gcloud run deploy failed for test service' }
  & gcloud run services update-traffic $env:TEST_SERVICE_NAME --region $env:TEST_REGION --to-latest
  if ($LASTEXITCODE -ne 0) { Fail 'Failed to route test traffic to the latest revision' }

  $env:FIRESTORE_DATABASE_ID = $env:TEST_FIRESTORE_DATABASE_ID
  & (Join-Path $PSScriptRoot 'deploy-firestore-indexes.ps1')
  if ($LASTEXITCODE -ne 0) { Fail 'Firestore index deployment failed for test' }

  if ($Reseed) {
    Push-Location $Script:RepoRoot
    $previousSeedEnv = @{
      ALLOW_REMOTE_TEST_ACCOUNT_SEED = $env:ALLOW_REMOTE_TEST_ACCOUNT_SEED
      DB_PROVIDER = $env:DB_PROVIDER
      FIRESTORE_DATABASE_ID = $env:FIRESTORE_DATABASE_ID
      FIRESTORE_EMULATOR_HOST = $env:FIRESTORE_EMULATOR_HOST
      FIRESTORE_EMULATOR_HOST_PATH = $env:FIRESTORE_EMULATOR_HOST_PATH
    }
    try {
      $env:ALLOW_REMOTE_TEST_ACCOUNT_SEED = '1'
      $env:DB_PROVIDER = 'firebase'
      $env:FIRESTORE_DATABASE_ID = $env:TEST_FIRESTORE_DATABASE_ID
      Remove-Item Env:FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
      Remove-Item Env:FIRESTORE_EMULATOR_HOST_PATH -ErrorAction SilentlyContinue
      & npm run accounts:seed:remote
      if ($LASTEXITCODE -ne 0) { Fail 'npm run accounts:seed:remote failed' }
    } finally { Pop-Location }
    foreach ($entry in $previousSeedEnv.GetEnumerator()) {
      if ($null -eq $entry.Value) { Remove-Item "Env:$($entry.Key)" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$($entry.Key)" $entry.Value }
    }
  }

  Invoke-FirebaseHostingDeploy -ConfigFile $hostingConfig -Site $env:TEST_HOSTING_SITE
  & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl $env:TEST_DOMAIN -Environment 'test'
  if ($LASTEXITCODE -ne 0) { Fail 'Smoke test failed against test environment' }
}

$evidencePath = Join-Path $Script:RepoRoot "dist\release\release-test-evidence-$([System.IO.Path]::GetFileNameWithoutExtension($ReleaseManifest)).json"
$actor = if ($env:GITHUB_ACTOR) { $env:GITHUB_ACTOR } else { 'local' }
Write-LogJson -FilePath $evidencePath -Data ([ordered]@{
  status = 'passed'
  testedServiceUrl = $env:TEST_DOMAIN
  testedBackendImageDigest = $backendDigest
  testedFrontendSha256 = $frontendSha
  configFingerprint = $liveConfigFingerprint
  actor = $actor
  testedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
})
Write-Output $evidencePath
