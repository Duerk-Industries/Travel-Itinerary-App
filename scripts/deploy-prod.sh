#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/deploy-common.sh"
source "$SCRIPT_DIR/lib/require-github-actor.sh"

DRY_RUN=0
REASON=""
MANIFEST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --reason) REASON="$2"; shift 2 ;;
    --release-manifest) MANIFEST="$2"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ "${#REASON}" -ge 8 ]] || fail "--reason is required for direct production deploy"
load_deploy_config
require_vars PROD_SERVICE_NAME PROD_REGION PROD_HOSTING_SITE PROD_DOMAIN PROD_FIRESTORE_DATABASE_ID PROD_RUNTIME_SERVICE_ACCOUNT PROD_AI_CAPTURE_BUCKET
require_github_actor "$DRY_RUN"

echo "WARNING: direct production deploy bypasses test cutover. Reason: $REASON" >&2
if [[ -z "$MANIFEST" ]]; then
  build_args=()
  if [[ "$DRY_RUN" == "1" ]]; then
    build_args+=(--dry-run)
  fi
  MANIFEST="$(bash "$SCRIPT_DIR/build-release.sh" "${build_args[@]}")"
fi
node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" "$MANIFEST"
BACKEND_DIGEST="$(json_get "$MANIFEST" backendImageDigest)"

if [[ "$DRY_RUN" != "1" ]]; then
  gcloud run deploy "$PROD_SERVICE_NAME" \
    --image "$BACKEND_DIGEST" \
    --region "$PROD_REGION" \
    --service-account "$PROD_RUNTIME_SERVICE_ACCOUNT" \
    --update-env-vars "WEB_URL=$PROD_DOMAIN,FIRESTORE_DATABASE_ID=$PROD_FIRESTORE_DATABASE_ID,AI_CAPTURE_BUCKET=$PROD_AI_CAPTURE_BUCKET"
  firebase deploy --only "hosting:$PROD_HOSTING_SITE"
fi

write_log_json "$REPO_ROOT/dist/release/direct-prod-deploy-$(date -u +%Y%m%d%H%M%S).json" \
  "operation=deploy-prod" "reason=$REASON" "actor=${GITHUB_ACTOR:-local}" "releaseManifest=$MANIFEST" "targetService=$PROD_SERVICE_NAME"
