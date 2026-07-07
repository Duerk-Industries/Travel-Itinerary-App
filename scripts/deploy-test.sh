#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/deploy-common.sh"

DRY_RUN=0
RESEED=0
MANIFEST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --reseed) RESEED=1; shift ;;
    --release-manifest) MANIFEST="$2"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

load_deploy_config
require_vars TEST_SERVICE_NAME TEST_REGION TEST_HOSTING_SITE TEST_DOMAIN TEST_FIRESTORE_DATABASE_ID TEST_RUNTIME_SERVICE_ACCOUNT TEST_AI_CAPTURE_BUCKET PROD_FIRESTORE_DATABASE_ID PROD_AI_CAPTURE_BUCKET
node -e "const v=require('./scripts/lib/phase11-validators'); v.assertEnvironmentIsolation(process.env);"

if [[ -z "$MANIFEST" ]]; then
  build_args=()
  if [[ "$DRY_RUN" == "1" ]]; then
    build_args+=(--dry-run)
  fi
  MANIFEST="$(bash "$SCRIPT_DIR/build-release.sh" "${build_args[@]}")"
fi
node -e "const v=require('./scripts/lib/phase11-validators'); v.validateReleaseManifest(v.readJson(process.argv[1]));" "$MANIFEST"

BACKEND_DIGEST="$(json_get "$MANIFEST" backendImageDigest)"
FRONTEND_ARTIFACT="$(json_get "$MANIFEST" frontendArtifact)"
FRONTEND_SHA="$(json_get "$MANIFEST" frontendSha256)"
CONFIG_FINGERPRINT="$(json_get "$MANIFEST" configFingerprint)"
WORK_DIR="$REPO_ROOT/dist/deploy-test"
mkdir -p "$WORK_DIR/frontend"
tar -xzf "$FRONTEND_ARTIFACT" -C "$WORK_DIR/frontend"
ACTUAL_FRONTEND_SHA="$(sha256_file "$FRONTEND_ARTIFACT")"
[[ "$ACTUAL_FRONTEND_SHA" == "$FRONTEND_SHA" ]] || fail "Frontend artifact checksum mismatch"
render_template "$SCRIPT_DIR/firebase.hosting.test.template.json" "$WORK_DIR/firebase.hosting.test.json"

if [[ "$DRY_RUN" != "1" ]]; then
  gcloud run deploy "$TEST_SERVICE_NAME" \
    --image "$BACKEND_DIGEST" \
    --region "$TEST_REGION" \
    --service-account "$TEST_RUNTIME_SERVICE_ACCOUNT" \
    --update-env-vars "WEB_URL=$TEST_DOMAIN,FIRESTORE_DATABASE_ID=$TEST_FIRESTORE_DATABASE_ID,AI_CAPTURE_BUCKET=$TEST_AI_CAPTURE_BUCKET"
  FIRESTORE_DATABASE_ID="$TEST_FIRESTORE_DATABASE_ID" bash "$SCRIPT_DIR/deploy-firestore-indexes.sh"
  if [[ "$RESEED" == "1" ]]; then
    (cd "$REPO_ROOT" && npm run accounts:seed)
  fi
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$TEST_DOMAIN" --environment test
fi

EVIDENCE="$REPO_ROOT/dist/release/release-test-evidence-$(basename "$MANIFEST" .json).json"
write_log_json "$EVIDENCE" \
  "status=passed" \
  "testedServiceUrl=$TEST_DOMAIN" \
  "testedBackendImageDigest=$BACKEND_DIGEST" \
  "testedFrontendSha256=$FRONTEND_SHA" \
  "configFingerprint=$CONFIG_FINGERPRINT" \
  "actor=${GITHUB_ACTOR:-local}" \
  "testedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$EVIDENCE"
