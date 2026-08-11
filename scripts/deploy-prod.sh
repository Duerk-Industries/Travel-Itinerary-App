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
ensure_gcloud_project_id
require_vars GCLOUD_PROJECT_ID PROD_SERVICE_NAME PROD_REGION PROD_HOSTING_SITE PROD_DOMAIN PROD_FIRESTORE_DATABASE_ID PROD_RUNTIME_SERVICE_ACCOUNT PROD_AI_CAPTURE_BUCKET
DEPLOY_AUDIT_API_URL="${DEPLOY_AUDIT_API_URL:-${PROD_DOMAIN%/}/api/internal/deploy}"
require_github_actor "$DRY_RUN"

echo "WARNING: direct production deploy bypasses test cutover. Reason: $REASON" >&2
if [[ -z "$MANIFEST" ]]; then
  build_args=()
  if [[ "$DRY_RUN" == "1" ]]; then
    build_args+=(--dry-run)
  fi
  build_log="$(mktemp)"
  if ! bash "$SCRIPT_DIR/build-release.sh" "${build_args[@]}" >"$build_log" 2>&1; then
    cat "$build_log" >&2
    rm -f "$build_log"
    exit 1
  fi
  cat "$build_log"
  MANIFEST="$(tail -n 1 "$build_log" | tr -d '\r')"
  rm -f "$build_log"
  [[ -f "$MANIFEST" ]] || fail "Release build did not return a valid manifest path: $MANIFEST"
fi
node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" "$MANIFEST"
BACKEND_DIGEST="$(json_get "$MANIFEST" backendImageDigest)"
MANIFEST_GIT_SHA="$(json_get "$MANIFEST" gitSha)"
WORK_DIR="$REPO_ROOT/dist/deploy-prod"
prepare_frontend_from_manifest "$MANIFEST" "$WORK_DIR/frontend"
write_hosting_config "$WORK_DIR/firebase.hosting.generated.json" "$PROD_HOSTING_SITE" "$WORK_DIR/frontend" "$PROD_SERVICE_NAME" "$PROD_REGION" "$PROD_DOMAIN"
SECRET_ARG="$(cloud_run_secret_arg)"

if [[ "$DRY_RUN" != "1" ]]; then
  gcloud run deploy "$PROD_SERVICE_NAME" \
    --image "$BACKEND_DIGEST" \
    --region "$PROD_REGION" \
    --session-affinity \
    --max-instances 1 \
    --service-account "$PROD_RUNTIME_SERVICE_ACCOUNT" \
    --update-labels "app-git-sha=$MANIFEST_GIT_SHA" \
    --update-env-vars "GCLOUD_PROJECT_ID=$GCLOUD_PROJECT_ID,WEB_URL=$PROD_DOMAIN,BACKEND_URL=$PROD_DOMAIN,GOOGLE_CALLBACK_URL=$PROD_DOMAIN/api/auth/google/callback,APPLE_CALLBACK_URL=$PROD_DOMAIN/api/auth/apple/callback,FIRESTORE_DATABASE_ID=$PROD_FIRESTORE_DATABASE_ID,AI_CAPTURE_BUCKET=$PROD_AI_CAPTURE_BUCKET,DB_PROVIDER=firebase" \
    --set-secrets "$SECRET_ARG" \
    --remove-env-vars "$(cloud_run_secret_pairs | cut -d= -f1 | paste -sd, -)"
  gcloud run services update-traffic "$PROD_SERVICE_NAME" --region "$PROD_REGION" --to-latest
  firebase_deploy_hosting "$WORK_DIR/firebase.hosting.generated.json" "$PROD_HOSTING_SITE"
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$PROD_DOMAIN" --environment production-direct
fi

write_log_json "$REPO_ROOT/dist/release/direct-prod-deploy-$(date -u +%Y%m%d%H%M%S).json" \
  "operation=deploy-prod" "reason=$REASON" "actor=${GITHUB_ACTOR:-local}" "releaseManifest=$MANIFEST" "targetService=$PROD_SERVICE_NAME"
write_deploy_audit_log "DEPLOY_DIRECT_PROD" "$REASON" "$MANIFEST" \
  "$(node -e "console.log(JSON.stringify({backendImageDigest: process.argv[1]}))" "$BACKEND_DIGEST")"
