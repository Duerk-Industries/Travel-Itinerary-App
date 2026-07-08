$ErrorActionPreference = 'Stop'

$Script:DeployCommonDir = $PSScriptRoot
$Script:RepoRoot = (Resolve-Path (Join-Path $Script:DeployCommonDir '..\\..')).Path
if (-not $env:DEPLOY_CONFIG_FILE) {
  $env:DEPLOY_CONFIG_FILE = Join-Path $Script:RepoRoot 'scripts\deploy.config'
}

function Fail([string]$Message) {
  Write-Error "ERROR: $Message"
  exit 1
}

function Import-DeployConfig([string]$ConfigPath = $env:DEPLOY_CONFIG_FILE) {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Fail "Deploy config not found: $ConfigPath. Copy scripts/deploy.config.example to scripts/deploy.config."
  }
  foreach ($raw in Get-Content -LiteralPath $ConfigPath) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    $parts = $line -split '=', 2
    if ($parts.Length -ne 2) { continue }
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($key) { Set-Item -Path "env:$key" -Value $value }
  }
}

function Assert-RequiredVars([string[]]$Names) {
  $missing = @()
  foreach ($name in $Names) {
    $value = (Get-Item -Path "env:$name" -ErrorAction SilentlyContinue).Value
    if ([string]::IsNullOrWhiteSpace($value)) { $missing += $name }
  }
  if ($missing.Count -gt 0) {
    Fail "Missing required deploy config values: $($missing -join ', ')"
  }
}

function Get-Sha256File([string]$FilePath) {
  return (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Generic dotted-path JSON property getter (mirrors deploy-common.sh's
# json_get). Manifest/evidence *validation* and the configFingerprint hash
# themselves are separate node -e calls into phase11-validators.js made
# directly by each top-level script, identically on both bash and
# PowerShell -- this helper is just how both read individual fields back out.
function Get-JsonValue([string]$FilePath, [string]$PropertyPath) {
  $result = & node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const value=process.argv[2].split('.').reduce((o,k)=>o==null?undefined:o[k], data); if (value == null) process.exit(2); process.stdout.write(String(value));" $FilePath $PropertyPath
  if ($LASTEXITCODE -ne 0) { Fail "JSON property '$PropertyPath' not found in $FilePath" }
  return $result
}

function Get-ConfigFingerprint() {
  $script = @'
const v = require("./scripts/lib/phase11-validators");
console.log(v.configFingerprint(process.env));
'@
  $result = & node -e $script
  if ($LASTEXITCODE -ne 0) { Fail "Failed to compute configFingerprint" }
  return $result
}

function Write-LogJson([string]$FilePath, [hashtable]$Data) {
  $dir = Split-Path -Parent $FilePath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  ($Data | ConvertTo-Json -Depth 10) | Out-File -LiteralPath $FilePath -Encoding utf8
}

function Expand-FrontendFromManifest([string]$ManifestPath, [string]$OutputDir) {
  $frontendArtifact = Get-JsonValue $ManifestPath 'frontendArtifact'
  $expectedSha = Get-JsonValue $ManifestPath 'frontendSha256'
  if (Test-Path -LiteralPath $OutputDir) { Remove-Item -LiteralPath $OutputDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  $actualSha = Get-Sha256File $frontendArtifact
  if ($actualSha -ne $expectedSha) { Fail "Frontend artifact checksum mismatch" }
  & tar -xzf $frontendArtifact -C $OutputDir
  if ($LASTEXITCODE -ne 0) { Fail "Failed to extract frontend artifact $frontendArtifact" }
}

# Builds the same scoped Content-Security-Policy shape as the repo's
# firebase.json, parameterized by host, mirroring deploy-common.sh's
# write_hosting_config so PowerShell and bash deploys never diverge on CSP.
function New-HostingConfig([string]$OutputFile, [string]$Site, [string]$PublicDir, [string]$ServiceName, [string]$Region, [string]$DomainUrl) {
  $host_ = $DomainUrl -replace '^https?://', '' -replace '/$', ''
  if (-not $host_) { Fail "New-HostingConfig: DomainUrl is required to scope the CSP" }
  $csp = @(
    "default-src 'self' https://$host_"
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.gstatic.com https://www.google.com"
    "connect-src 'self' https://www.gstatic.com https://www.google.com https://$host_ wss://$host_ https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com"
    "img-src 'self' https://$host_ https://images.unsplash.com data: blob: https://www.gstatic.com https://www.google.com https://maps.googleapis.com https://maps.gstatic.com https://storage.googleapis.com https://places.googleapis.com"
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
    "font-src 'self' https://fonts.gstatic.com"
    "frame-src 'self' https://www.google.com https://recaptcha.google.com"
    "worker-src 'self' blob:"
    "base-uri 'self'"
    "form-action 'self'"
  ) -join '; '
  $csp += ';'
  $config = @{
    hosting = @{
      site = $Site
      public = $PublicDir
      ignore = @('firebase.json', '**/.*', '**/node_modules/**')
      headers = @(
        @{ source = '/index.html'; headers = @(@{ key = 'Cache-Control'; value = 'no-store, max-age=0' }) }
        @{ source = '**'; headers = @(@{ key = 'Content-Security-Policy'; value = $csp }) }
      )
      rewrites = @(
        @{ source = '/api/**'; run = @{ serviceId = $ServiceName; region = $Region } }
        @{ source = '/socket.io/**'; run = @{ serviceId = $ServiceName; region = $Region } }
        @{ source = '**'; destination = '/index.html' }
      )
    }
  }
  ($config | ConvertTo-Json -Depth 10) | Out-File -LiteralPath $OutputFile -Encoding utf8
}

# All Phase 11 scripts must go through this helper rather than calling a bare
# `firebase` binary, which is not preinstalled on GitHub-hosted runners.
function Invoke-FirebaseHostingDeploy([string]$ConfigFile, [string]$Site) {
  $projectArgs = @()
  if ($env:GCLOUD_PROJECT_ID) { $projectArgs = @('--project', $env:GCLOUD_PROJECT_ID) }
  & npx --yes firebase-tools deploy --config $ConfigFile --only "hosting:$Site" --non-interactive @projectArgs
  if ($LASTEXITCODE -ne 0) { Fail "firebase-tools deploy failed for site $Site" }
}

function Get-LiveServiceImage([string]$Service, [string]$Region) {
  $result = & gcloud run services describe $Service --region $Region --format='value(spec.template.spec.containers[0].image)'
  if ($LASTEXITCODE -ne 0) { Fail "Failed to describe Cloud Run service $Service" }
  return $result
}

# Returns the URL Cloud Run assigned to a specific traffic tag, so smoke
# tests can target the actual new revision instead of the service's public
# URL, which still points at the previous revision until traffic is shifted.
function Get-TaggedRevisionUrl([string]$Service, [string]$Region, [string]$Tag) {
  $json = & gcloud run services describe $Service --region $Region --format=json
  if ($LASTEXITCODE -ne 0) { Fail "Failed to describe Cloud Run service $Service" }
  $script = @'
const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
const tag = process.argv[1];
const entry = (s.status.traffic || []).find((t) => t.tag === tag);
if (!entry || !entry.url) { process.exit(2); }
process.stdout.write(entry.url);
'@
  $url = $json | & node -e $script $Tag
  if ($LASTEXITCODE -ne 0) { Fail "Could not resolve tagged revision URL for tag '$Tag' on $Service" }
  return $url
}

# Writes the deploy audit trail through the internal deploy API instead of
# only a local JSON file, so cutover/rollback/teardown/direct-deploy
# operations show up in the same audit_log every other privileged action in
# this codebase uses. Best-effort: warns and continues rather than failing
# the whole operation if the audit call itself fails.
function Write-DeployAuditLog([string]$Action, [string]$Reason, [string]$ReleaseManifest, [hashtable]$Details = @{}) {
  if (-not $env:DEPLOY_AUDIT_API_URL -or -not $env:DEPLOY_WORKER_SHARED_SECRET) {
    Write-Warning "DEPLOY_AUDIT_API_URL/DEPLOY_WORKER_SHARED_SECRET not set; skipping durable audit_log write for $Action"
    return
  }
  $actor = if ($env:GITHUB_ACTOR) { $env:GITHUB_ACTOR } else { 'local' }
  $body = @{
    action = $Action
    reason = $Reason
    actor = $actor
    releaseManifest = $ReleaseManifest
    details = $Details
  } | ConvertTo-Json -Depth 10
  try {
    Invoke-RestMethod -Method Post -Uri "$($env:DEPLOY_AUDIT_API_URL)/audit-log" `
      -Headers @{ 'X-Deploy-Worker-Secret' = $env:DEPLOY_WORKER_SHARED_SECRET } `
      -ContentType 'application/json' -Body $body | Out-Null
  } catch {
    Write-Warning "audit_log write for $Action did not succeed: $($_.Exception.Message)"
  }
}
