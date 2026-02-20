#!/usr/bin/env bash
set -euo pipefail

# This script deploys the frontend application to Firebase Hosting.
# It builds the web app from app/ into dist/ first.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Building web bundle..."
(cd "$REPO_ROOT/app" && npx expo export --platform web --output-dir ../dist)

echo "Deploying frontend to Firebase Hosting..."
(cd "$REPO_ROOT" && firebase deploy --only hosting)

echo "Firebase Hosting deployment completed."
