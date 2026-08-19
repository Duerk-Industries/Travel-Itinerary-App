$ErrorActionPreference = 'Stop'

# This script deploys the frontend application to Firebase Hosting.
# It loads app/.env into the current process so Expo can embed env vars at build time.

Write-Host "Loading app/.env into process environment..."
$envPath = Join-Path $PSScriptRoot "..\\app\\.env"
if (Test-Path $envPath) {
  Get-Content $envPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $parts = $line -split '=', 2
    if ($parts.Length -ne 2) { return }
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($key) { Set-Item -Path "env:$key" -Value $value }
  }
} else {
  Write-Warning "app/.env not found; continuing without loading env vars."
}

# Ensure EXPO_PUBLIC_* variants for web build if only FIREBASE_* keys exist.
$expoMap = @{
  'FIREBASE_API_KEY' = 'EXPO_PUBLIC_FIREBASE_API_KEY'
  'FIREBASE_AUTH_DOMAIN' = 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'
  'FIREBASE_PROJECT_ID' = 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'
  'FIREBASE_APP_ID' = 'EXPO_PUBLIC_FIREBASE_APP_ID'
  'RECAPTCHA_SITE_KEY' = 'EXPO_PUBLIC_RECAPTCHA_SITE_KEY'
}
foreach ($src in $expoMap.Keys) {
  $dst = $expoMap[$src]
  $dstValue = (Get-Item -Path "env:$dst" -ErrorAction SilentlyContinue).Value
  $srcValue = (Get-Item -Path "env:$src" -ErrorAction SilentlyContinue).Value
  if (-not $dstValue -and $srcValue) {
    Set-Item -Path "env:$dst" -Value $srcValue
  }
}

Write-Host "Building web bundle..."
Push-Location (Join-Path $PSScriptRoot "..\\app")
try {
  & npm run export:web -- --output-dir ../dist
} finally {
  Pop-Location
}

Write-Host "Deploying frontend to Firebase Hosting..."
& npx firebase-tools deploy --only hosting
Write-Host "Firebase Hosting deployment completed."

# Also kick off the Cloud Run API deploy (.github/workflows/deploy-api.yml) for the branch
# currently checked out. That workflow normally only runs on a push to main; dispatching it here
# lets a fix on any branch (e.g. an emergency hotfix that hasn't been merged to main yet) actually
# reach Cloud Run, the same way pushing to main would. Requires the GitHub CLI (`gh`), authenticated
# (`gh auth login`), and the workflow_dispatch trigger to already be present on main — see the
# comment at the top of deploy-api.yml.
Write-Host "Triggering API deploy (deploy-api.yml) via GitHub Actions..."
$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCommand) {
  Write-Warning "GitHub CLI ('gh') not found; skipping API deploy trigger. Install it (https://cli.github.com/) or run 'gh workflow run deploy-api.yml --ref <branch>' yourself."
} else {
  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  if (-not $branch -or $branch -eq 'HEAD') {
    Write-Warning "Could not determine current branch (detached HEAD?); skipping API deploy trigger."
  } else {
    & gh workflow run deploy-api.yml --ref $branch
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Failed to trigger deploy-api.yml for branch '$branch'. If this is the first time, make sure the workflow_dispatch trigger has been merged to main, and that you're authenticated ('gh auth status')."
    } else {
      Write-Host "Triggered deploy-api.yml for branch '$branch'. Track it with: gh run list --workflow=deploy-api.yml --limit 1"
    }
  }
}
