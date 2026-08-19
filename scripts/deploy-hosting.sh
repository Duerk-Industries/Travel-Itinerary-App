#!/usr/bin/env bash
set -euo pipefail

# This script deploys the frontend application to Firebase Hosting.
# It builds the web app from app/ into dist/ first.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Building web bundle..."
(cd "$REPO_ROOT/app" && npm run export:web -- --output-dir ../dist)

echo "Deploying frontend to Firebase Hosting..."
(cd "$REPO_ROOT" && firebase deploy --only hosting)

echo "Firebase Hosting deployment completed."

# Also kick off the Cloud Run API deploy (.github/workflows/deploy-api.yml) for the branch
# currently checked out. That workflow normally only runs on a push to main; dispatching it here
# lets a fix on any branch (e.g. an emergency hotfix that hasn't been merged to main yet) actually
# reach Cloud Run, the same way pushing to main would. Requires the GitHub CLI (`gh`), authenticated
# (`gh auth login`), and the workflow_dispatch trigger to already be present on main — see the
# comment at the top of deploy-api.yml.
echo "Triggering API deploy (deploy-api.yml) via GitHub Actions..."
if ! command -v gh >/dev/null 2>&1; then
  echo "Warning: GitHub CLI ('gh') not found; skipping API deploy trigger. Install it (https://cli.github.com/) or run 'gh workflow run deploy-api.yml --ref <branch>' yourself." >&2
else
  branch="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
  if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
    echo "Warning: could not determine current branch (detached HEAD?); skipping API deploy trigger." >&2
  elif gh workflow run deploy-api.yml --ref "$branch"; then
    echo "Triggered deploy-api.yml for branch '$branch'. Track it with: gh run list --workflow=deploy-api.yml --limit 1"
  else
    echo "Warning: failed to trigger deploy-api.yml for branch '$branch'. If this is the first time, make sure the workflow_dispatch trigger has been merged to main, and that you're authenticated ('gh auth status')." >&2
  fi
fi
