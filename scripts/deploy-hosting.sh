#!/usr/bin/env bash
set -euo pipefail

# This script deploys the frontend application to Firebase Hosting.
# It assumes you have already built the web app (e.g., via `npx expo export:web`).

echo "Deploying frontend to Firebase Hosting..."

firebase deploy --only hosting

echo "Firebase Hosting deployment completed."
