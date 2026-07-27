#!/usr/bin/env bash
set -euo pipefail

BASE_URL=""
ENVIRONMENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$BASE_URL" ]] || { echo "ERROR: --base-url is required" >&2; exit 1; }
[[ -n "$ENVIRONMENT" ]] || { echo "ERROR: --environment is required" >&2; exit 1; }

HEALTH_URL="${BASE_URL%/}/api/healthz"
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTH_URL")"
[[ "$STATUS" == "200" ]] || { echo "ERROR: health check failed at $HEALTH_URL status=$STATUS" >&2; exit 1; }

echo "Smoke test passed for $ENVIRONMENT at $BASE_URL"
