param(
  [switch]$DryRun,
  [string]$OutputDir,
  [string]$BuilderRunId
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\deploy-common.ps1')
Import-DeployConfig
Assert-RequiredVars @('ARTIFACT_REGISTRY_REPO')

if (-not $OutputDir) { $OutputDir = Join-Path $Script:RepoRoot 'dist\release' }
if (-not $BuilderRunId) { $BuilderRunId = if ($env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID } else { "local-$(Get-Date -Format 'yyyyMMddHHmmss')" } }

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$gitSha = (& git rev-parse HEAD).Trim()
$shortSha = (& git rev-parse --short HEAD).Trim()
$frontendDir = Join-Path $OutputDir 'frontend'
$frontendArchive = Join-Path $OutputDir "frontend-$shortSha.tgz"
$manifestPath = Join-Path $OutputDir "release-manifest-$shortSha.json"

if ($DryRun) {
  New-Item -ItemType Directory -Force -Path $frontendDir | Out-Null
  "dry-run frontend $gitSha" | Out-File -LiteralPath (Join-Path $frontendDir 'index.html') -Encoding utf8
} else {
  Push-Location $Script:RepoRoot
  try {
    & npm run validate:app
    if ($LASTEXITCODE -ne 0) { Fail 'npm run validate:app failed' }
    & npm run validate:server
    if ($LASTEXITCODE -ne 0) { Fail 'npm run validate:server failed' }
  } finally { Pop-Location }
  Push-Location (Join-Path $Script:RepoRoot 'app')
  try {
    $env:RELEASE_WEB_BUILD = '1'
    # --clear bypasses Metro's bundler cache. Without it, a cache entry from a
    # build made before RELEASE_WEB_BUILD existed (or with a different env)
    # can be reused verbatim -- Metro's cache key isn't sensitive to env vars
    # like EXPO_PUBLIC_BACKEND_URL, so a stale bake-in can silently persist
    # across releases even though the source and config are correct.
    & npm run export:web -- "--output-dir=$frontendDir" --clear
    if ($LASTEXITCODE -ne 0) { Fail 'npm run export:web failed' }
  } finally {
    Remove-Item Env:RELEASE_WEB_BUILD -ErrorAction SilentlyContinue
    Pop-Location
  }
}

# Served alongside the frontend so cutover-test-to-prod.ps1 can confirm the
# artifact actually live on the test Hosting site is this exact build,
# rather than trusting an internally-consistent-but-unverified evidence file
# (Chapter 16 §5.4 step 1).
$marker = @{ gitSha = $gitSha; builderRunId = $BuilderRunId } | ConvertTo-Json
$marker | Out-File -LiteralPath (Join-Path $frontendDir 'deploy-marker.json') -Encoding utf8

if (Test-Path -LiteralPath $frontendArchive) { Remove-Item -LiteralPath $frontendArchive -Force }
& tar -czf $frontendArchive -C $frontendDir .
if ($LASTEXITCODE -ne 0) { Fail 'Failed to archive frontend build' }

$frontendSha = Get-Sha256File $frontendArchive
$indexSha = Get-Sha256File (Join-Path $Script:RepoRoot 'firestore.indexes.json')
$configFingerprint = Get-ConfigFingerprint
$dryRunDigestHex = ($gitSha.Substring(0, [Math]::Min(40, $gitSha.Length)).PadRight(40, '0')) + ('0' * 24)
$imageDigest = "$($env:ARTIFACT_REGISTRY_REPO)/backend:${shortSha}@sha256:$dryRunDigestHex"

if (-not $DryRun) {
  $imageTag = "$($env:ARTIFACT_REGISTRY_REPO)/backend:$shortSha"
  & gcloud builds submit (Join-Path $Script:RepoRoot 'server') --tag $imageTag
  if ($LASTEXITCODE -ne 0) { Fail 'gcloud builds submit failed' }
  $digestOnly = (& gcloud container images describe $imageTag --format='value(image_summary.digest)').Trim()
  if ($LASTEXITCODE -ne 0) { Fail 'gcloud container images describe failed' }
  $imageDigest = "$($imageTag.Split('@')[0])@$digestOnly"
}

$manifest = [ordered]@{
  gitSha = $gitSha
  backendImageDigest = $imageDigest
  frontendArtifact = $frontendArchive
  frontendSha256 = $frontendSha
  firestoreIndexesSha256 = $indexSha
  configFingerprint = $configFingerprint
  builtAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  builderRunId = $BuilderRunId
}
($manifest | ConvertTo-Json -Depth 10) | Out-File -LiteralPath $manifestPath -Encoding utf8

& node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" $manifestPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output $manifestPath
