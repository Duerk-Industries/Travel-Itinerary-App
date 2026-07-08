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
require_vars PROD_SERVICE_NAME PROD_REGION PROD_DOMAIN ROLLBACK_RETENTION_DAYS
DEPLOY_AUDIT_API_URL="${DEPLOY_AUDIT_API_URL:-${PROD_DOMAIN%/}/api/internal/deploy}"
require_github_actor "$DRY_RUN"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry run: would delete 0%-traffic revisions older than $ROLLBACK_RETENTION_DAYS days for $PROD_SERVICE_NAME"
  exit 0
fi

SERVICE_JSON="$(gcloud run services describe "$PROD_SERVICE_NAME" --region "$PROD_REGION" --format=json)"
CUTOFF_EPOCH="$(node -e "console.log(Math.floor(Date.now()/1000) - Number(process.argv[1]) * 86400);" "$ROLLBACK_RETENTION_DAYS")"
DELETED=()

mapfile -t revisions < <(gcloud run revisions list --service "$PROD_SERVICE_NAME" --region "$PROD_REGION" --format='value(metadata.name,status.conditions[0].lastTransitionTime)')
for row in "${revisions[@]}"; do
  revision="${row%%$'\t'*}"
  last_transition="${row#*$'\t'}"
  traffic="$(echo "$SERVICE_JSON" | node -e "const s=JSON.parse(require('fs').readFileSync(0,'utf8')); const r=process.argv[1]; const t=(s.status.traffic||[]).find(x=>x.revisionName===r); process.stdout.write(String(t?.percent||0));" "$revision")"
  if [[ "$traffic" != "0" ]]; then
    echo "Skipping $revision because traffic=$traffic"
    continue
  fi
  revision_epoch="$(node -e "const d=new Date(process.argv[1]); process.stdout.write(isNaN(d.getTime())?'0':String(Math.floor(d.getTime()/1000)));" "$last_transition")"
  if [[ -z "$revision_epoch" || "$revision_epoch" == "0" || "$revision_epoch" -gt "$CUTOFF_EPOCH" ]]; then
    echo "Skipping $revision because it is younger than $ROLLBACK_RETENTION_DAYS days (lastTransitionTime=$last_transition)"
    continue
  fi
  gcloud run revisions delete "$revision" --region "$PROD_REGION" --quiet
  DELETED+=("$revision")
done

write_deploy_audit_log "DEPLOY_TEARDOWN" "Teardown of 0%-traffic revisions older than $ROLLBACK_RETENTION_DAYS days" "" \
  "$(node -e "console.log(JSON.stringify({service: process.argv[1], deletedRevisions: process.argv.slice(2)}))" "$PROD_SERVICE_NAME" "${DELETED[@]}")"
