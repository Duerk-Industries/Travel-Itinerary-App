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
  & npx expo export --platform web --output-dir ../dist
} finally {
  Pop-Location
}

Write-Host "Deploying frontend to Firebase Hosting..."
& npx firebase-tools deploy --only hosting
Write-Host "Firebase Hosting deployment completed."
