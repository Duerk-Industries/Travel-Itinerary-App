#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/deploy-common.sh"
source "$SCRIPT_DIR/lib/require-github-actor.sh"

DRY_RUN=0
MANIFEST=""
EVIDENCE=""
STAGED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --release-manifest) MANIFEST="$2"; shift 2 ;;
    --test-evidence) EVIDENCE="$2"; shift 2 ;;
    --staged) STAGED=1; shift ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ -n "$MANIFEST" ]] || fail "--release-manifest is required"
[[ -n "$EVIDENCE" ]] || fail "--test-evidence is required"
load_deploy_config
require_vars TEST_SERVICE_NAME TEST_REGION PROD_SERVICE_NAME PROD_REGION PROD_DOMAIN PROD_RUNTIME_SERVICE_ACCOUNT PROD_FIRESTORE_DATABASE_ID PROD_AI_CAPTURE_BUCKET
require_github_actor "$DRY_RUN"
node -e "const v=require('./scripts/lib/phase11-validators'); const m=v.readJson(process.argv[1]); const e=v.readJson(process.argv[2]); v.validateReleaseManifest(m); v.validateTestEvidence(m,e);" "$MANIFEST" "$EVIDENCE"

BACKEND_DIGEST="$(json_get "$MANIFEST" backendImageDigest)"
if [[ "$DRY_RUN" != "1" ]]; then
  gcloud run deploy "$PROD_SERVICE_NAME" --image "$BACKEND_DIGEST" --region "$PROD_REGION" --no-traffic --tag candidate --service-account "$PROD_RUNTIME_SERVICE_ACCOUNT"
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$PROD_DOMAIN" --environment prod-candidate
  if [[ "$STAGED" == "1" ]]; then
    for pct in 10 50 100; do
      gcloud run services update-traffic "$PROD_SERVICE_NAME" --region "$PROD_REGION" --to-tags "candidate=$pct"
    done
  else
    gcloud run services update-traffic "$PROD_SERVICE_NAME" --region "$PROD_REGION" --to-tags candidate=100
  fi
  firebase deploy --only hosting
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$PROD_DOMAIN" --environment production
fi
write_log_json "$REPO_ROOT/dist/release/cutover-$(date -u +%Y%m%d%H%M%S).json" \
  "operation=cutover" "actor=${GITHUB_ACTOR:-local}" "releaseManifest=$MANIFEST" "testEvidence=$EVIDENCE" "backendImageDigest=$BACKEND_DIGEST"
