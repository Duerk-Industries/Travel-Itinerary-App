#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${1:-}" ]] || [[ -z "${2:-}" ]]; then
  echo "Usage: $0 <YOUR_GCLOUD_PROJECT_ID> <YOUR_GCLOUD_PROJECT_NUMBER>" >&2
  echo "You can find the project number in the Google Cloud Console dashboard." >&2
  exit 1
fi

PROJECT_ID="$1"
PROJECT_NUMBER="$2"
SERVICE_ACCOUNT_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Adding IAM policy bindings for service account: $SERVICE_ACCOUNT_EMAIL"

echo "Granting role 'roles/datastore.user'..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/datastore.user"

echo "Granting role 'roles/secretmanager.secretAccessor'..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

echo "IAM permissions set successfully."
