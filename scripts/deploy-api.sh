#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-travel-itinerary-app}"
REGION="${REGION:-us-east5}"
SOURCE_DIR="${SOURCE_DIR:-server}"

# This script deploys the API code without changing environment variables or secrets.
# Use ./scripts/configure-run-env.sh to manage the service's environment.

echo "Deploying Cloud Run service source code..."
echo "  Service: $SERVICE_NAME"
echo "  Region: $REGION"
echo "  Source: $SOURCE_DIR"

gcloud run deploy "$SERVICE_NAME" \
  --source "$SOURCE_DIR" \
  --region "$REGION"

echo "API deployment completed."
