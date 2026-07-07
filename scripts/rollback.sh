#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/deploy-common.sh"
source "$SCRIPT_DIR/lib/require-github-actor.sh"

DRY_RUN=0
MANIFEST=""
REVISION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --release-manifest) MANIFEST="$2"; shift 2 ;;
    --revision) REVISION="$2"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ -n "$MANIFEST" ]] || fail "--release-manifest is required so frontend/backend rollback remains paired"
[[ -n "$REVISION" ]] || fail "--revision is required"
load_deploy_config
require_vars PROD_SERVICE_NAME PROD_REGION PROD_DOMAIN
require_github_actor "$DRY_RUN"
node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" "$MANIFEST"

if [[ "$DRY_RUN" != "1" ]]; then
  gcloud run services update-traffic "$PROD_SERVICE_NAME" --region "$PROD_REGION" --to-revisions "$REVISION=100"
  FRONTEND_ARTIFACT="$(json_get "$MANIFEST" frontendArtifact)"
  rm -rf "$REPO_ROOT/dist/rollback-frontend"
  mkdir -p "$REPO_ROOT/dist/rollback-frontend"
  tar -xzf "$FRONTEND_ARTIFACT" -C "$REPO_ROOT/dist/rollback-frontend"
  firebase deploy --only hosting
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$PROD_DOMAIN" --environment production-rollback
fi
write_log_json "$REPO_ROOT/dist/release/rollback-$(date -u +%Y%m%d%H%M%S).json" \
  "operation=rollback" "actor=${GITHUB_ACTOR:-local}" "releaseManifest=$MANIFEST" "revision=$REVISION"
