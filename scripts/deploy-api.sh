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

# This script deploys API code, applies non-secret env vars from .env,
# and applies secret mappings by secret name via --set-secrets.

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

env_pairs=()
saw_google_application_credentials=0
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
declare -A secret_map=()
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
if [[ "${#env_pairs[@]}" -gt 0 ]]; then
  env_arg="$(IFS=,; echo "${env_pairs[*]}")"
  echo "Non-secret env vars to upload:"
  for pair in "${env_pairs[@]}"; do
    echo "  $pair"
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

gcloud run deploy "$SERVICE_NAME" \
  --source "$SOURCE_DIR" \
  --region "$REGION" \
  ${env_arg:+--update-env-vars "$env_arg"} \
  ${secrets_arg:+--set-secrets "$secrets_arg"} \
  ${secret_keys_arg:+--remove-env-vars "$secret_keys_arg"} \
  ${remove_env_arg:+--remove-env-vars "$remove_env_arg"}

echo "API deployment completed."
