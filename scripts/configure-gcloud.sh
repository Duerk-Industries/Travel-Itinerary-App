#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${1:-}" ]]; then
  echo "Usage: $0 <YOUR_GCLOUD_PROJECT_ID>" >&2
  exit 1
fi

PROJECT_ID="$1"

echo "Logging into gcloud..."
gcloud auth login

echo "Setting default project to '$PROJECT_ID'..."
gcloud config set project "$PROJECT_ID"

echo "gcloud configured successfully."
