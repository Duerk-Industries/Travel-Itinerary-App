#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/deploy-common.sh"
load_deploy_config
require_vars TEST_SERVICE_NAME TEST_REGION PROD_SERVICE_NAME PROD_REGION

describe_service() {
  local label="$1" service="$2" region="$3"
  echo "== $label =="
  gcloud run services describe "$service" \
    --region "$region" \
    --format='table(status.latestReadyRevisionName,status.traffic[].revisionName,status.traffic[].percent,status.url)' || true
}

describe_service test "$TEST_SERVICE_NAME" "$TEST_REGION"
describe_service production "$PROD_SERVICE_NAME" "$PROD_REGION"
