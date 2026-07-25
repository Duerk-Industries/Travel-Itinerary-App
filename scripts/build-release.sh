#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/deploy-common.sh
source "$SCRIPT_DIR/lib/deploy-common.sh"

DRY_RUN=0
OUTPUT_DIR="$REPO_ROOT/dist/release"
BUILDER_RUN_ID="${GITHUB_RUN_ID:-local-$(date -u +%Y%m%d%H%M%S)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --builder-run-id) BUILDER_RUN_ID="$2"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

load_deploy_config
require_vars ARTIFACT_REGISTRY_REPO

mkdir -p "$OUTPUT_DIR"
GIT_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
FRONTEND_DIR="$OUTPUT_DIR/frontend"
FRONTEND_ARCHIVE="$OUTPUT_DIR/frontend-${SHORT_SHA}.tgz"
MANIFEST="$OUTPUT_DIR/release-manifest-${SHORT_SHA}.json"

if [[ "$DRY_RUN" == "1" ]]; then
  mkdir -p "$FRONTEND_DIR"
  printf 'dry-run frontend %s\n' "$GIT_SHA" > "$FRONTEND_DIR/index.html"
else
  (cd "$REPO_ROOT" && npm run validate:app && npm run validate:server)
  # --clear bypasses Metro's bundler cache -- see build-release.ps1 for why
  # this is required (a stale cached bundle from before RELEASE_WEB_BUILD
  # existed silently kept baking in the old backend URL across releases).
  (cd "$REPO_ROOT/app" && RELEASE_WEB_BUILD=1 npm run export:web -- "--output-dir=$FRONTEND_DIR" --clear)
fi

# Served alongside the frontend so cutover-test-to-prod.sh can confirm the
# artifact actually live on the test Hosting site is this exact build,
# rather than trusting an internally-consistent-but-unverified evidence file
# (Chapter 16 §5.4 step 1).
node -e "const fs=require('fs'); fs.writeFileSync(process.argv[1] + '/deploy-marker.json', JSON.stringify({gitSha: process.argv[2], builderRunId: process.argv[3]}, null, 2) + '\n');" \
  "$FRONTEND_DIR" "$GIT_SHA" "$BUILDER_RUN_ID"

tar -czf "$FRONTEND_ARCHIVE" -C "$FRONTEND_DIR" .
FRONTEND_SHA="$(sha256_file "$FRONTEND_ARCHIVE")"
INDEX_SHA="$(sha256_file "$REPO_ROOT/firestore.indexes.json")"
CONFIG_FINGERPRINT="$(node -e "const v=require('./scripts/lib/phase11-validators'); console.log(v.configFingerprint(process.env));")"
IMAGE_DIGEST="${ARTIFACT_REGISTRY_REPO}/backend:${SHORT_SHA}@sha256:${GIT_SHA:0:40}000000000000000000000000"

if [[ "$DRY_RUN" != "1" ]]; then
  IMAGE_TAG="${ARTIFACT_REGISTRY_REPO}/backend:${SHORT_SHA}"
  gcloud builds submit "$REPO_ROOT/server" --tag "$IMAGE_TAG"
  IMAGE_DIGEST="$(gcloud container images describe "$IMAGE_TAG" --format='value(image_summary.digest)')"
  IMAGE_DIGEST="${IMAGE_TAG%@*}@${IMAGE_DIGEST}"
fi

node - "$MANIFEST" <<NODE
const fs = require('fs');
const manifest = {
  gitSha: '$GIT_SHA',
  backendImageDigest: '$IMAGE_DIGEST',
  frontendArtifact: '$FRONTEND_ARCHIVE',
  frontendSha256: '$FRONTEND_SHA',
  firestoreIndexesSha256: '$INDEX_SHA',
  configFingerprint: '$CONFIG_FINGERPRINT',
  builtAt: new Date().toISOString(),
  builderRunId: '$BUILDER_RUN_ID'
};
fs.writeFileSync(process.argv[2], JSON.stringify(manifest, null, 2) + '\n');
NODE

node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" "$MANIFEST"
echo "$MANIFEST"
