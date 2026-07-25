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
ensure_gcloud_project_id
require_vars GCLOUD_PROJECT_ID TEST_SERVICE_NAME TEST_REGION TEST_HOSTING_SITE TEST_DOMAIN TEST_FIRESTORE_DATABASE_ID TEST_RUNTIME_SERVICE_ACCOUNT TEST_AI_CAPTURE_BUCKET PROD_FIRESTORE_DATABASE_ID PROD_AI_CAPTURE_BUCKET
node -e "const v=require('./scripts/lib/phase11-validators'); v.assertEnvironmentIsolation(process.env);"

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
FRONTEND_ARTIFACT="$(json_get "$MANIFEST" frontendArtifact)"
FRONTEND_SHA="$(json_get "$MANIFEST" frontendSha256)"
MANIFEST_CONFIG_FINGERPRINT="$(json_get "$MANIFEST" configFingerprint)"
# Recompute the fingerprint from the config actually loaded for *this*
# deploy, rather than trusting the manifest's own value — otherwise the
# check that's supposed to catch "this build assumes config that isn't
# live yet" (Chapter 16 §5.1) can never fail, because it would just be
# comparing the manifest to itself.
LIVE_CONFIG_FINGERPRINT="$(node -e "const v=require('./scripts/lib/phase11-validators'); console.log(v.configFingerprint(process.env));")"
if [[ "$LIVE_CONFIG_FINGERPRINT" != "$MANIFEST_CONFIG_FINGERPRINT" ]]; then
  fail "Config fingerprint drift: manifest was built against different deploy config than scripts/deploy.config currently loaded. Rebuild the manifest before deploying to test."
fi
WORK_DIR="$REPO_ROOT/dist/deploy-test"
prepare_frontend_from_manifest "$MANIFEST" "$WORK_DIR/frontend"
write_hosting_config "$WORK_DIR/firebase.hosting.generated.json" "$TEST_HOSTING_SITE" "$WORK_DIR/frontend" "$TEST_SERVICE_NAME" "$TEST_REGION" "$TEST_DOMAIN"
SECRET_ARG="$(cloud_run_secret_arg)"

if [[ "$DRY_RUN" != "1" ]]; then
  gcloud run deploy "$TEST_SERVICE_NAME" \
    --image "$BACKEND_DIGEST" \
    --region "$TEST_REGION" \
    --session-affinity \
    --service-account "$TEST_RUNTIME_SERVICE_ACCOUNT" \
    --update-labels "app-git-sha=$(json_get "$MANIFEST" gitSha)" \
    --update-env-vars "GCLOUD_PROJECT_ID=$GCLOUD_PROJECT_ID,WEB_URL=$TEST_DOMAIN,FIRESTORE_DATABASE_ID=$TEST_FIRESTORE_DATABASE_ID,AI_CAPTURE_BUCKET=$TEST_AI_CAPTURE_BUCKET,DB_PROVIDER=firebase" \
    --set-secrets "$SECRET_ARG" \
    --remove-env-vars "$(cloud_run_secret_pairs | cut -d= -f1 | paste -sd, -)"
  gcloud run services update-traffic "$TEST_SERVICE_NAME" --region "$TEST_REGION" --to-latest
  FIRESTORE_DATABASE_ID="$TEST_FIRESTORE_DATABASE_ID" bash "$SCRIPT_DIR/deploy-firestore-indexes.sh"
  if [[ "$RESEED" == "1" ]]; then
    (cd "$REPO_ROOT" && \
      ALLOW_REMOTE_TEST_ACCOUNT_SEED=1 \
      DB_PROVIDER=firebase \
      FIRESTORE_DATABASE_ID="$TEST_FIRESTORE_DATABASE_ID" \
      FIRESTORE_EMULATOR_HOST= \
      FIRESTORE_EMULATOR_HOST_PATH= \
      npm run accounts:seed:remote)
  fi
  firebase_deploy_hosting "$WORK_DIR/firebase.hosting.generated.json" "$TEST_HOSTING_SITE"
  bash "$SCRIPT_DIR/smoke-test.sh" --base-url "$TEST_DOMAIN" --environment test
fi

EVIDENCE="$REPO_ROOT/dist/release/release-test-evidence-$(basename "$MANIFEST" .json).json"
write_log_json "$EVIDENCE" \
  "status=passed" \
  "testedServiceUrl=$TEST_DOMAIN" \
  "testedBackendImageDigest=$BACKEND_DIGEST" \
  "testedFrontendSha256=$FRONTEND_SHA" \
  "configFingerprint=$LIVE_CONFIG_FINGERPRINT" \
  "actor=${GITHUB_ACTOR:-local}" \
  "testedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$EVIDENCE"
