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
require_vars PROD_SERVICE_NAME PROD_REGION PROD_HOSTING_SITE PROD_DOMAIN
DEPLOY_AUDIT_API_URL="${DEPLOY_AUDIT_API_URL:-${PROD_DOMAIN%/}/api/internal/deploy}"
require_github_actor "$DRY_RUN"
node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" "$MANIFEST"
MANIFEST_BACKEND_DIGEST="$(json_get "$MANIFEST" backendImageDigest)"

# Refuse to pair a frontend artifact with a backend revision it was never
# actually built/tested with (Chapter 16 §5.5) -- without this check, a
# mistyped --revision would still "succeed," silently recreating the
# version-mismatch risk this unified script exists to prevent.
if [[ "$DRY_RUN" != "1" ]]; then
  REVISION_IMAGE="$(gcloud run revisions describe "$REVISION" --region "$PROD_REGION" --format='value(spec.containers[0].image)')"
  case "$REVISION_IMAGE" in
    *"$MANIFEST_BACKEND_DIGEST"*) : ;;
    *) fail "Rollback refused: revision $REVISION is running image $REVISION_IMAGE, which does not match --release-manifest's backendImageDigest ($MANIFEST_BACKEND_DIGEST)." ;;
  esac
fi

WORK_DIR="$REPO_ROOT/dist/rollback-frontend"
prepare_frontend_from_manifest "$MANIFEST" "$WORK_DIR/frontend"
write_hosting_config "$WORK_DIR/firebase.hosting.generated.json" "$PROD_HOSTING_SITE" "$WORK_DIR/frontend" "$PROD_SERVICE_NAME" "$PROD_REGION" "$PROD_DOMAIN"

if [[ "$DRY_RUN" != "1" ]]; then
  gcloud run services update-traffic "$PROD_SERVICE_NAME" --region "$PROD_REGION" --to-revisions "$REVISION=100"
  firebase_deploy_hosting "$WORK_DIR/firebase.hosting.generated.json" "$PROD_HOSTING_SITE"
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$PROD_DOMAIN" --environment production-rollback
fi
write_log_json "$REPO_ROOT/dist/release/rollback-$(date -u +%Y%m%d%H%M%S).json" \
  "operation=rollback" "actor=${GITHUB_ACTOR:-local}" "releaseManifest=$MANIFEST" "revision=$REVISION"
write_deploy_audit_log "DEPLOY_ROLLBACK" "Rollback to revision $REVISION" "$MANIFEST" \
  "$(node -e "console.log(JSON.stringify({revision: process.argv[1]}))" "$REVISION")"
