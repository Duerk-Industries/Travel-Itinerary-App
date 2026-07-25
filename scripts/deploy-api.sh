#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-travel-itinerary-app}"
REGION="${REGION:-us-east5}"
SOURCE_DIR="${SOURCE_DIR:-server}"
ENV_FILE="${ENV_FILE:-}"
SECRETS_FILE="${SECRETS_FILE:-}"
SECRETS="${SECRETS:-}"
IGNORE_KEYS="${IGNORE_KEYS:-PORT,FIRESTORE_EMULATOR_HOST,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS}"
IGNORE_SECRET_KEYS="${IGNORE_SECRET_KEYS:-GCLOUD_PROJECT,GOOGLE_CLOUD_PROJECT,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS}"
SKIP_FIRESTORE_INDEXES="${SKIP_FIRESTORE_INDEXES:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# This script deploys API code, applies env vars from .env directly,
# and applies optional secret mappings from .secrets or SECRETS via --set-secrets.

echo "Deploying Cloud Run service source code..."
echo "  Service: $SERVICE_NAME"
echo "  Region: $REGION"
echo "  Source: $SOURCE_DIR"

if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="server/.env"
fi
if [[ -z "$SECRETS_FILE" && -f "server/.secrets" ]]; then
  SECRETS_FILE="server/.secrets"
fi

if [[ "$SKIP_FIRESTORE_INDEXES" != "1" ]]; then
  "$SCRIPT_DIR/deploy-firestore-indexes.sh"
else
  echo "Skipping Firestore index deployment because SKIP_FIRESTORE_INDEXES=1."
fi

trim() {
  local input="$1"
  input="${input#${input%%[![:space:]]*}}"
  input="${input%${input##*[![:space:]]}}"
  printf '%s' "$input"
}

is_comment_or_empty() {
  local line="$1"
  line="$(trim "$line")"
  [[ -z "$line" || "$line" == \#* ]]
}

strip_inline_comment() {
  local line="$1"
  local out=""
  local in_single=0
  local in_double=0
  local escaped=0
  local i ch prev
  for ((i=0; i<${#line}; i++)); do
    ch="${line:$i:1}"
    if ((escaped)); then
      out+="$ch"
      escaped=0
      continue
    fi
    if [[ "$ch" == \\ ]]; then
      out+="$ch"
      escaped=1
      continue
    fi
    if [[ "$ch" == "'" && $in_double -eq 0 ]]; then
      ((in_single = 1 - in_single))
      out+="$ch"
      continue
    fi
    if [[ "$ch" == '"' && $in_single -eq 0 ]]; then
      ((in_double = 1 - in_double))
      out+="$ch"
      continue
    fi
    if [[ "$ch" == \# && $in_single -eq 0 && $in_double -eq 0 ]]; then
      prev="${line:$((i-1)):1}"
      if [[ $i -eq 0 || "$prev" == " " || "$prev" == $'	' ]]; then
        break
      fi
    fi
    out+="$ch"
  done
  printf '%s' "$out"
}

should_ignore_key() {
  local key="$1"
  local list=",${IGNORE_KEYS},"
  [[ "$list" == *",$key,"* ]]
}

should_ignore_secret_key() {
  local key="$1"
  local list=",${IGNORE_SECRET_KEYS},"
  [[ "$list" == *",$key,"* ]]
}

is_visible_env_key() {
  local key="$1"
  case "$key" in
    GCLOUD_PROJECT_ID|GOOGLE_CLOUD_PROJECT|GOOGLE_CALLBACK_URL|LOCATION_BUCKET|LOCATION_RAW_CSV_PREFIX|FIRESTORE_DATABASE_ID|DB_PROVIDER|USE_IN_MEMORY_DB|SMTP_HOST|SMTP_PORT|SMTP_FROM|UNSPLASH_APP_ID|UNSPLASH_IMAGE_CACHE_TIMEOUT_MINUTES|SIGNED_IMAGE_URL_CACHE_TIMEOUT_MINUTES|GOOGLE_PLACES_DETAILS_CACHE_TIMEOUT_MINUTES|STORAGE_IMAGE_CACHE_CONTROL_TIMEOUT_MINUTES|UNSPLASH_AUTH_BLOCK_CACHE_TIMEOUT_MINUTES|SESSION_CACHE_TIMEOUT_MINUTES|PLACE_MATCH_THRESHOLD|AUTH_REDIRECT_URI_ALLOWLIST|EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN|EXPO_PUBLIC_FIREBASE_PROJECT_ID|EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET|EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID|EXPO_PUBLIC_FIREBASE_APP_ID)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

display_env_pair() {
  local pair="$1"
  local key="${pair%%=*}"
  local value="${pair#*=}"
  if is_visible_env_key "$key"; then
    printf '%s=%s' "$key" "$value"
  else
    printf '%s=<redacted>' "$key"
  fi
}

dedupe_preserve_order() {
  declare -A seen=()
  local value
  for value in "$@"; do
    [[ -z "$value" || -n "${seen[$value]:-}" ]] && continue
    seen["$value"]=1
    printf '%s\n' "$value"
  done
}

cleanup_legacy_secrets() {
  local phase_label="$1"
  local allow_clear_fallback="$2"
  if [[ -z "${remove_secrets_arg:-}" ]]; then
    return 0
  fi

  echo "${phase_label} legacy secret bindings for .env-managed keys..."
  if gcloud run services update "$SERVICE_NAME" \
    --region "$REGION" \
    --remove-secrets "$remove_secrets_arg"; then
    return 0
  fi

  if [[ "$allow_clear_fallback" != "1" ]]; then
    return 1
  fi

  echo "WARNING: ${phase_label} targeted secret cleanup failed; retrying with --clear-secrets to remove stale Cloud Run secret bindings." >&2
  gcloud run services update "$SERVICE_NAME" \
    --region "$REGION" \
    --clear-secrets
}

env_pairs=()
declare -A secret_map=()
saw_google_application_credentials=0
auth_secret_from_env=""
if [[ -n "$ENV_FILE" ]]; then
  if [[ "$(basename "$ENV_FILE")" == ".local_env" ]]; then
    echo "Refusing to read .local_env for Cloud Run env vars." >&2
    exit 1
  fi
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Env file not found: $ENV_FILE" >&2
    exit 1
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'\r'}"
    if is_comment_or_empty "$line"; then
      continue
    fi
    if [[ "$line" == export\ * ]]; then
      line="${line#export }"
    fi
    line="$(strip_inline_comment "$line")"
    line="$(trim "$line")"
    [[ "$line" != *"="* ]] && continue
    key="$(trim "${line%%=*} ")"
    value="$(trim "${line#*=}")"
    if [[ "$key" == "GOOGLE_APPLICATION_CREDENTIALS" ]]; then
      saw_google_application_credentials=1
    fi
    if [[ "$value" =~ ^".*"$ || "$value" =~ ^'.*'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    if [[ "$key" == "AUTH_SECRET" ]]; then
      auth_secret_from_env="$value"
    fi
    if should_ignore_key "$key"; then
      continue
    fi
    value="${value//,/\\,}"
    env_pairs+=("${key}=${value}")
  done < "$ENV_FILE"
fi
if [[ "$saw_google_application_credentials" -eq 1 ]]; then
  echo "WARNING: GOOGLE_APPLICATION_CREDENTIALS is present in ${ENV_FILE}. Cloud Run should use ADC via its runtime service account; this key is ignored for deploy." >&2
fi

env_arg=""
if [[ -n "$SECRETS" ]]; then
  IFS=',' read -r -a secret_entries <<< "$SECRETS"
  for entry in "${secret_entries[@]}"; do
    [[ -z "$entry" || "$entry" != *"="* ]] && continue
    key="$(trim "${entry%%=*}")"
    value="$(trim "${entry#*=}")"
    [[ -z "$key" || -z "$value" ]] && continue
    if [[ "$value" != *:* ]]; then
      value="${value}:latest"
    fi
    secret_map["$key"]="$value"
  done
fi
if [[ -n "$SECRETS_FILE" && -f "$SECRETS_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'\r'}"
    if is_comment_or_empty "$line"; then
      continue
    fi
    if [[ "$line" == export\ * ]]; then
      line="${line#export }"
    fi
    line="$(strip_inline_comment "$line")"
    line="$(trim "$line")"
    [[ "$line" != *"="* ]] && continue
    key="$(trim "${line%%=*} ")"
    [[ -z "$key" ]] && continue
    if should_ignore_secret_key "$key"; then
      continue
    fi
    secret_map["$key"]="${key}:latest"
  done < "$SECRETS_FILE"
fi
has_auth_secret_mapping=0
if [[ -n "${secret_map[AUTH_SECRET]:-}" ]]; then
  has_auth_secret_mapping=1
fi
trimmed_auth_secret="$(trim "$auth_secret_from_env")"
has_safe_auth_secret_env=0
if [[ -n "$trimmed_auth_secret" && "$trimmed_auth_secret" != "development-secret" ]]; then
  has_safe_auth_secret_env=1
fi
if [[ "$has_auth_secret_mapping" -eq 0 && "$has_safe_auth_secret_env" -eq 0 ]]; then
  echo "AUTH_SECRET is required for Cloud Run deploy. Add AUTH_SECRET to server/.secrets and create a matching Secret Manager secret, or set a non-default AUTH_SECRET in the deploy env file." >&2
  exit 1
fi
if [[ "${#secret_map[@]}" -gt 0 ]]; then
  filtered_env_pairs=()
  for pair in "${env_pairs[@]}"; do
    key="${pair%%=*}"
    if [[ -n "${secret_map[$key]:-}" ]]; then
      continue
    fi
    filtered_env_pairs+=("$pair")
  done
  env_pairs=("${filtered_env_pairs[@]}")
fi
env_keys=()
for pair in "${env_pairs[@]}"; do
  env_keys+=("${pair%%=*}")
done
if [[ "${#env_keys[@]}" -gt 0 ]]; then
  mapfile -t env_keys < <(dedupe_preserve_order "${env_keys[@]}")
fi
if [[ "${#env_pairs[@]}" -gt 0 ]]; then
  env_arg="$(IFS=,; echo "${env_pairs[*]}")"
  echo "Env vars to upload:"
  for pair in "${env_pairs[@]}"; do
    echo "  $(display_env_pair "$pair")"
  done
fi
secrets_arg=""
secret_keys_arg=""
if [[ "${#secret_map[@]}" -gt 0 ]]; then
  secret_pairs=()
  secret_keys=()
  for key in "${!secret_map[@]}"; do
    secret_pairs+=("${key}=${secret_map[$key]}")
    secret_keys+=("${key}")
  done
  secrets_arg="$(IFS=,; echo "${secret_pairs[*]}")"
  secret_keys_arg="$(IFS=,; echo "${secret_keys[*]}")"
  echo "Secret mappings to apply (names only):"
  for key in "${!secret_map[@]}"; do
    echo "  ${key} -> ${secret_map[$key]}"
  done
fi
remove_env_keys=()
for key in FIRESTORE_EMULATOR_HOST GOOGLE_APPLICATION_CREDENTIALS; do
  if should_ignore_key "$key"; then
    remove_env_keys+=("$key")
  fi
done
remove_env_arg=""
if [[ "${#remove_env_keys[@]}" -gt 0 ]]; then
  remove_env_arg="$(IFS=,; echo "${remove_env_keys[*]}")"
fi
remove_secrets_arg=""
if [[ "${#env_keys[@]}" -gt 0 ]]; then
  remove_secrets_arg="$(IFS=,; echo "${env_keys[*]}")"
fi

if [[ -n "$remove_secrets_arg" ]]; then
  if gcloud run services describe "$SERVICE_NAME" --region "$REGION" >/dev/null 2>&1; then
    allow_clear_fallback=0
    if [[ "${#secret_map[@]}" -eq 0 ]]; then
      allow_clear_fallback=1
    fi
    cleanup_legacy_secrets "Removing pre-deploy" "$allow_clear_fallback"
  fi
fi

gcloud run deploy "$SERVICE_NAME" \
  --source "$SOURCE_DIR" \
  --region "$REGION" \
  --session-affinity \
  ${env_arg:+--update-env-vars "$env_arg"} \
  ${secrets_arg:+--set-secrets "$secrets_arg"} \
  ${secret_keys_arg:+--remove-env-vars "$secret_keys_arg"} \
  ${remove_env_arg:+--remove-env-vars "$remove_env_arg"}

# A prior canary deploy with --no-traffic pins the service away from LATEST
# until this is explicitly restored; gcloud run deploy alone does not undo it.
gcloud run services update-traffic "$SERVICE_NAME" \
  --region "$REGION" \
  --to-latest

if [[ -n "$remove_secrets_arg" ]]; then
  allow_clear_fallback=0
  if [[ "${#secret_map[@]}" -eq 0 ]]; then
    allow_clear_fallback=1
  fi
  cleanup_legacy_secrets "Removing post-deploy" "$allow_clear_fallback"
fi

echo "API deployment completed."
