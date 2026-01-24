#!/usr/bin/env bash
#
# Configures all necessary IAM permissions for the project's service accounts.
#
# This script is idempotent and can be re-run safely. It ensures that the
# deployer service account (used by CI/CD) can trigger builds, the Cloud Build
# service account can execute deployments, and the runtime service account can
# access necessary Google Cloud resources.
#
# Usage:
#   ./scripts/configure-gcp-iam.sh [path/to/secrets/file]
#
# The script reads the following variables from the specified file (or ./server/.secrets):
#   - GCLOUD_PROJECT_ID (required)
#   - GCLOUD_PROJECT_NUMBER (required)
#   - DEPLOYER_SERVICE_ACCOUNT_EMAIL (required)
#   - RUNTIME_SERVICE_ACCOUNT_EMAIL (optional, defaults to Compute Engine default SA)
#
set -euo pipefail

SECRETS_FILE="${1:-./server/.secrets}"

# --- Helper Functions ---

# Function to print a message to stderr
log() {
  echo "[INFO] $@" >&2
}

# Function to print an error message to stderr and exit
fail() {
  echo "[ERROR] $@" >&2
  exit 1
}

# --- Variable Loading ---

if [[ ! -f "$SECRETS_FILE" ]]; then
  fail "Secrets file not found at '$SECRETS_FILE'. Please create it or provide a path."
fi

# Source the file to load variables.
set -a
# shellcheck source=/dev/null
source <(grep -vE '^\s*#' "$SECRETS_FILE" | grep -v '^\s*$')
set +a

# --- Variable Validation and Defaults ---

if [[ -z "${GCLOUD_PROJECT_ID:-}" ]]; then
  fail "GCLOUD_PROJECT_ID must be set in '$SECRETS_FILE'."
fi
if [[ -z "${GCLOUD_PROJECT_NUMBER:-}" ]]; then
  fail "GCLOUD_PROJECT_NUMBER must be set in '$SECRETS_FILE'."
fi
if [[ -z "${DEPLOYER_SERVICE_ACCOUNT_EMAIL:-}" ]]; then
  fail "DEPLOYER_SERVICE_ACCOUNT_EMAIL must be set in '$SECRETS_FILE'."
fi

# Define service account emails
GCLOUD_PROJECT_ID="${GCLOUD_PROJECT_ID}"
GCLOUD_PROJECT_NUMBER="${GCLOUD_PROJECT_NUMBER}"
DEPLOYER_SERVICE_ACCOUNT_EMAIL="${DEPLOYER_SERVICE_ACCOUNT_EMAIL}"
RUNTIME_SERVICE_ACCOUNT_EMAIL="${RUNTIME_SERVICE_ACCOUNT_EMAIL:-${GCLOUD_PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"
CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL="${GCLOUD_PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

log "Project:                  $GCLOUD_PROJECT_ID"
log "Deployer SA (CI/CD):      $DEPLOYER_SERVICE_ACCOUNT_EMAIL"
log "Cloud Build SA (Builder): $CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL"
log "Runtime SA (Cloud Run):   $RUNTIME_SERVICE_ACCOUNT_EMAIL"
log "-----------------------------------------------------"

# --- IAM Bindings for Deployer Service Account ---

log "Granting permissions to Deployer Service Account ($DEPLOYER_SERVICE_ACCOUNT_EMAIL)..."

# Roles needed by the CI/CD system (e.g., GitHub Actions) to trigger builds and manage secrets.
DEPLOYER_ROLES=(
  "roles/cloudbuild.builds.editor"    # Create and manage Cloud Builds
  "roles/artifactregistry.writer"     # Push to Artifact Registry (e.g., for build artifacts)
  "roles/logging.logWriter"           # Write build and deploy logs
  "roles/secretmanager.admin"         # Create and manage application secrets
)

for role in "${DEPLOYER_ROLES[@]}"; do
  log "  - Ensuring project role: $role"
  gcloud projects add-iam-policy-binding "$GCLOUD_PROJECT_ID" \
    --member="serviceAccount:$DEPLOYER_SERVICE_ACCOUNT_EMAIL" \
    --role="$role" \
    --condition=None >/dev/null
done

# --- IAM Bindings for Cloud Build Service Account ---

log "Granting permissions to Cloud Build Service Account ($CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL)..."

# Roles needed by Cloud Build to execute `gcloud run deploy` and attach a service account.
CLOUD_BUILD_ROLES=(
  "roles/run.admin" # Deploy and manage Cloud Run services
)

for role in "${CLOUD_BUILD_ROLES[@]}"; do
  log "  - Ensuring project role: $role"
  gcloud projects add-iam-policy-binding "$GCLOUD_PROJECT_ID" \
    --member="serviceAccount:$CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL" \
    --role="$role" \
    --condition=None >/dev/null
done

log "  - Ensuring Cloud Build SA can act as the Runtime SA (roles/iam.serviceAccountUser)"
# This binding allows Cloud Build to attach the runtime SA to the new Cloud Run revision.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SERVICE_ACCOUNT_EMAIL" \
  --project="$GCLOUD_PROJECT_ID" \
  --member="serviceAccount:$CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL" \
  --role="roles/iam.serviceAccountUser" >/dev/null

# --- IAM Bindings for Runtime Service Account ---

log "Granting permissions to Runtime Service Account ($RUNTIME_SERVICE_ACCOUNT_EMAIL)..."

# Roles needed by the application when it is running in Cloud Run.
RUNTIME_ROLES=(
  "roles/datastore.user"              # Access Firestore database
  "roles/secretmanager.secretAccessor"  # Access secrets mapped as env vars
)

for role in "${RUNTIME_ROLES[@]}"; do
  log "  - Ensuring project role: $role"
  gcloud projects add-iam-policy-binding "$GCLOUD_PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT_EMAIL" \
    --role="$role" \
    --condition=None >/dev/null
done

log "-----------------------------------------------------"
log "IAM configuration complete."

