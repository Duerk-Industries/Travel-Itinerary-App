#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/deploy-common.sh"
source "$SCRIPT_DIR/lib/require-github-actor.sh"

DRY_RUN=0
CONFIRM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --confirm) CONFIRM="${2%$'\r'}"; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

[[ "$CONFIRM" == "yes-delete" ]] || fail "--confirm yes-delete is required"
load_deploy_config
require_vars PROD_SERVICE_NAME PROD_REGION ROLLBACK_RETENTION_DAYS
require_github_actor "$DRY_RUN"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry run: would delete 0%-traffic revisions older than $ROLLBACK_RETENTION_DAYS days for $PROD_SERVICE_NAME"
  exit 0
fi

mapfile -t revisions < <(gcloud run revisions list --service "$PROD_SERVICE_NAME" --region "$PROD_REGION" --format='value(metadata.name,status.conditions[0].lastTransitionTime)')
for row in "${revisions[@]}"; do
  revision="${row%%$'\t'*}"
  traffic="$(gcloud run services describe "$PROD_SERVICE_NAME" --region "$PROD_REGION" --format=json | node -e "const s=JSON.parse(require('fs').readFileSync(0,'utf8')); const r=process.argv[1]; const t=(s.status.traffic||[]).find(x=>x.revisionName===r); process.stdout.write(String(t?.percent||0));" "$revision")"
  if [[ "$traffic" != "0" ]]; then
    echo "Skipping $revision because traffic=$traffic"
    continue
  fi
  gcloud run revisions delete "$revision" --region "$PROD_REGION" --quiet
done
