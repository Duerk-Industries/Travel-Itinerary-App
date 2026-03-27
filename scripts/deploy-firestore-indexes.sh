#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCLOUD_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-${GCLOUD_PROJECT:-}}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INDEXES_FILE="$REPO_ROOT/firestore.indexes.json"

if [[ ! -f "$INDEXES_FILE" ]]; then
  echo "Firestore indexes file not found: $INDEXES_FILE" >&2
  exit 1
fi

echo "Deploying Firestore indexes..."
echo "  Indexes: $INDEXES_FILE"
if [[ -n "$PROJECT_ID" ]]; then
  echo "  Project: $PROJECT_ID"
fi

cmd=(firebase-tools deploy --only firestore:indexes)
if [[ -n "$PROJECT_ID" ]]; then
  cmd+=(--project "$PROJECT_ID")
fi

(cd "$REPO_ROOT" && npx "${cmd[@]}")

echo "Firestore index deployment completed."
