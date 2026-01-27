$ErrorActionPreference = 'Stop'

# This script deploys the frontend application to Firebase Hosting.
# It assumes you have already built the web app (e.g., via `npx expo export:web`).

Write-Host "Deploying frontend to Firebase Hosting..."
& firebase deploy --only hosting
Write-Host "Firebase Hosting deployment completed."
