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
require_vars TEST_SERVICE_NAME TEST_REGION TEST_DOMAIN PROD_SERVICE_NAME PROD_REGION PROD_HOSTING_SITE PROD_DOMAIN PROD_RUNTIME_SERVICE_ACCOUNT PROD_FIRESTORE_DATABASE_ID PROD_AI_CAPTURE_BUCKET
DEPLOY_AUDIT_API_URL="${DEPLOY_AUDIT_API_URL:-${PROD_DOMAIN%/}/api/internal/deploy}"
require_github_actor "$DRY_RUN"
node -e "const v=require('./scripts/lib/phase11-validators'); const m=v.readJson(process.argv[1]); const e=v.readJson(process.argv[2]); v.validateReleaseManifest(m); v.validateTestEvidence(m,e);" "$MANIFEST" "$EVIDENCE"

BACKEND_DIGEST="$(json_get "$MANIFEST" backendImageDigest)"
MANIFEST_GIT_SHA="$(json_get "$MANIFEST" gitSha)"
MANIFEST_CONFIG_FINGERPRINT="$(json_get "$MANIFEST" configFingerprint)"

# Cutover-time live-infrastructure verification (Chapter 16 §5.4 step 1).
# validateTestEvidence above only checks the manifest and evidence JSON
# files are internally consistent with each other -- it does not prove the
# artifacts were actually live in test. These checks close that gap.
LIVE_TEST_IMAGE="$(live_service_image "$TEST_SERVICE_NAME" "$TEST_REGION")"
case "$LIVE_TEST_IMAGE" in
  *"$BACKEND_DIGEST"*) : ;;
  *) fail "Cutover refused: image currently deployed to $TEST_SERVICE_NAME ($LIVE_TEST_IMAGE) does not match the manifest's backendImageDigest ($BACKEND_DIGEST)." ;;
esac

if [[ "$DRY_RUN" != "1" ]]; then
  TEST_MARKER_JSON="$(curl -sS -f "${TEST_DOMAIN%/}/deploy-marker.json")" || fail "Cutover refused: could not fetch deploy-marker.json from $TEST_DOMAIN to verify the live test frontend artifact."
  TEST_MARKER_GIT_SHA="$(echo "$TEST_MARKER_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).gitSha || '');")"
  [[ "$TEST_MARKER_GIT_SHA" == "$MANIFEST_GIT_SHA" ]] || fail "Cutover refused: frontend artifact live at $TEST_DOMAIN (gitSha=$TEST_MARKER_GIT_SHA) does not match the manifest being promoted (gitSha=$MANIFEST_GIT_SHA)."
fi

LIVE_CONFIG_FINGERPRINT="$(node -e "const v=require('./scripts/lib/phase11-validators'); console.log(v.configFingerprint(process.env));")"
[[ "$LIVE_CONFIG_FINGERPRINT" == "$MANIFEST_CONFIG_FINGERPRINT" ]] || fail "Cutover refused: configFingerprint drift between the manifest and the deploy config cutover is about to use. Rebuild before promoting."

WORK_DIR="$REPO_ROOT/dist/cutover-prod"
prepare_frontend_from_manifest "$MANIFEST" "$WORK_DIR/frontend"
write_hosting_config "$WORK_DIR/firebase.hosting.generated.json" "$PROD_HOSTING_SITE" "$WORK_DIR/frontend" "$PROD_SERVICE_NAME" "$PROD_REGION" "$PROD_DOMAIN"

CANARY_TRIP_ID=""
cleanup_canary() {
  if [[ -n "$CANARY_TRIP_ID" && -n "${DEPLOY_AUDIT_API_URL:-}" && -n "${DEPLOY_WORKER_SHARED_SECRET:-}" ]]; then
    curl -sS -o /dev/null -X POST "$DEPLOY_AUDIT_API_URL/canary-smoke-cleanup" \
      -H "X-Deploy-Worker-Secret: $DEPLOY_WORKER_SHARED_SECRET" \
      -H 'Content-Type: application/json' \
      -d "$(node -e "console.log(JSON.stringify({tripIds:[process.argv[1]]}))" "$CANARY_TRIP_ID")" \
      || echo "WARNING: canary smoke cleanup request failed for trip=$CANARY_TRIP_ID" >&2
  fi
}
# Runs on every exit path (success, smoke-test failure, or script error)
# so the canary account's data footprint never grows across cutovers
# (Chapter 16 §6) -- cleanup must not depend on the cutover having gone well.
trap cleanup_canary EXIT

if [[ "$DRY_RUN" != "1" ]]; then
  gcloud run deploy "$PROD_SERVICE_NAME" --image "$BACKEND_DIGEST" --region "$PROD_REGION" --no-traffic --tag candidate \
    --service-account "$PROD_RUNTIME_SERVICE_ACCOUNT" --update-labels "app-git-sha=$MANIFEST_GIT_SHA"

  CANDIDATE_URL="$(tagged_revision_url "$PROD_SERVICE_NAME" "$PROD_REGION" candidate)" || fail "Cutover refused: could not resolve the candidate revision's tagged URL."

  if [[ -n "${DEPLOY_WORKER_SHARED_SECRET:-}" ]]; then
    CANARY_WRITE_RESPONSE="$(curl -sS -f -X POST "${CANDIDATE_URL%/}/api/internal/deploy/canary-smoke-write" \
      -H "X-Deploy-Worker-Secret: $DEPLOY_WORKER_SHARED_SECRET" \
      -H 'Content-Type: application/json' \
      -d "$(node -e "console.log(JSON.stringify({cutoverLabel: process.argv[1]}))" "$MANIFEST_GIT_SHA")")" || fail "Cutover refused: canary smoke write against the candidate revision failed."
    CANARY_TRIP_ID="$(echo "$CANARY_WRITE_RESPONSE" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).tripId || '');")"
  else
    echo "WARNING: DEPLOY_WORKER_SHARED_SECRET not set; skipping canary write/cleanup (Chapter 16 §5.4 step 3)." >&2
  fi

  # Tests the candidate revision itself (via its own tagged URL) against
  # production's real database, before it receives any public traffic --
  # smoke-testing PROD_DOMAIN here would only re-test the outgoing revision.
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$CANDIDATE_URL" --environment prod-candidate

  if [[ "$STAGED" == "1" ]]; then
    for pct in 10 50 100; do
      gcloud run services update-traffic "$PROD_SERVICE_NAME" --region "$PROD_REGION" --to-tags "candidate=$pct"
    done
  else
    gcloud run services update-traffic "$PROD_SERVICE_NAME" --region "$PROD_REGION" --to-tags candidate=100
  fi
  firebase_deploy_hosting "$WORK_DIR/firebase.hosting.generated.json" "$PROD_HOSTING_SITE"
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$PROD_DOMAIN" --environment production
fi

write_log_json "$REPO_ROOT/dist/release/cutover-$(date -u +%Y%m%d%H%M%S).json" \
  "operation=cutover" "actor=${GITHUB_ACTOR:-local}" "releaseManifest=$MANIFEST" "testEvidence=$EVIDENCE" "backendImageDigest=$BACKEND_DIGEST"
write_deploy_audit_log "DEPLOY_CUTOVER" "Promotion of $MANIFEST_GIT_SHA from test to production" "$MANIFEST" \
  "$(node -e "console.log(JSON.stringify({backendImageDigest: process.argv[1], staged: process.argv[2] === '1'}))" "$BACKEND_DIGEST" "$STAGED")"
