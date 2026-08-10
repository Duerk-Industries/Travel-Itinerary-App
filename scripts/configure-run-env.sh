#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=""
SECRETS_FILE="${SECRETS_FILE:-}"
SERVICE_NAME="${SERVICE_NAME:-travel-itinerary-app}"
REGION="${REGION:-us-east5}"
IGNORE_KEYS="${IGNORE_KEYS:-PORT,FIRESTORE_EMULATOR_HOST,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS}"
IGNORE_SECRET_KEYS="${IGNORE_SECRET_KEYS:-GCLOUD_PROJECT,GOOGLE_CLOUD_PROJECT,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,GOOGLE_APPLICATION_CREDENTIALS}"
SECRETS="${SECRETS:-}"

usage() {
  echo "Usage: $0 [path/to/.env]" >&2
  echo "Configures Cloud Run env vars from .env and optional Secret Manager mappings from .secrets/SECRETS without deploying code." >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      ;;
    *)
      if [[ -z "$ENV_FILE" ]]; then
        ENV_FILE="$1"
        shift
      else
        usage
      fi
      ;;
  esac
done

if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="server/.env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

if [[ "$(basename "$ENV_FILE")" == ".local_env" ]]; then
  echo "Refusing to configure using .local_env (local-only values should not be uploaded)." >&2
  exit 1
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

# gcloud's --update-env-vars/--set-secrets flags use comma-delimited KEY=VALUE
# items by default. Values such as ZAI_MODELS=a,b,c require a custom delimiter;
# backslash-escaping commas is not supported reliably by gcloud.
get_safe_gcloud_delimiter() {
  local joined="$1"
  local candidate
  for candidate in '@' '~' '#' '|' '!'; do
    if [[ "$joined" != *"$candidate"* ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
  printf 'DELIM_%s' "$(date +%s%N)"
}

join_gcloud_dict_arg() {
  local -a pairs=("$@")
  local joined="${pairs[*]}"
  local delimiter
  delimiter="$(get_safe_gcloud_delimiter "$joined")"
  local result="^${delimiter}^"
  local pair
  local first=1
  for pair in "${pairs[@]}"; do
    if (( first )); then
      first=0
    else
      result+="$delimiter"
    fi
    result+="$pair"
  done
  printf '%s' "$result"
}

env_pairs=()
project_id=""
declare -A secret_map=()
auth_secret_from_env=""
saw_google_application_credentials=0

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%$'
'}"
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
  if [[ "$key" == "GCLOUD_PROJECT_ID" || "$key" == "GOOGLE_CLOUD_PROJECT" ]]; then
    project_id="$value"
  fi
  env_pairs+=("${key}=${value}")
done < "$ENV_FILE"

if [[ "$saw_google_application_credentials" -eq 1 ]]; then
  echo "WARNING: GOOGLE_APPLICATION_CREDENTIALS is present in ${ENV_FILE}. Cloud Run should use ADC via its runtime service account; this key is ignored for deploy." >&2
fi

if [[ -z "$project_id" && -n "$SECRETS_FILE" && -f "$SECRETS_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'
'}"
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
    if [[ "$value" =~ ^".*"$ || "$value" =~ ^'.*'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    if [[ "$key" == "GCLOUD_PROJECT_ID" || "$key" == "GOOGLE_CLOUD_PROJECT" ]]; then
      project_id="$value"
      break
    fi
  done < "$SECRETS_FILE"
fi

if [[ -n "$SECRETS" ]]; then
  IFS=',' read -r -a secret_entries <<< "$SECRETS"
  for entry in "${secret_entries[@]}"; do
    [[ -z "$entry" || "$entry" != *"="* ]] && continue
    key="${entry%%=*} "
    value="${entry#*=}"
    if [[ -n "$key" && -n "$value" ]]; then
      secret_map["$key"]="$value"
    fi
  done
fi

if [[ -n "${SECRETS_FILE}" && -f "${SECRETS_FILE}" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'
'}"
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
    # Name-only mapping: secret values are not read/uploaded by this script.
    if [[ -z "${secret_map[$key]:-}" ]]; then
      secret_map["$key"]="$key:latest"
    fi
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
  echo "AUTH_SECRET is required for Cloud Run configuration. Add AUTH_SECRET to server/.secrets and create a matching Secret Manager secret, or set a non-default AUTH_SECRET in the deploy env file." >&2
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
if [[ "${#env_pairs[@]}" -eq 0 ]]; then
  echo "No env vars parsed from $ENV_FILE after filtering .secrets-managed keys." >&2
  exit 1
fi
env_arg="$(join_gcloud_dict_arg "${env_pairs[@]}")"
env_keys=()
for pair in "${env_pairs[@]}"; do
  env_keys+=("${pair%%=*}")
done

secrets_arg=""
if [[ "${#secret_map[@]}" -gt 0 ]]; then
  secret_pairs=()
  for key in "${!secret_map[@]}"; do
    secret_pairs+=("${key}=${secret_map[$key]}")
  done
  # Secret Manager references contain no commas, so keep --set-secrets in its
  # normal comma-separated form for compatibility across gcloud versions.
  secrets_arg="$(IFS=,; echo "${secret_pairs[*]}")"
fi

cmd=(gcloud run services update "$SERVICE_NAME" --region "$REGION" --update-env-vars "$env_arg")
if [[ -n "$project_id" ]]; then
  cmd+=(--project "$project_id")
fi
if [[ -n "$secrets_arg" ]]; then
  cmd+=(--set-secrets "$secrets_arg")
else
  # If there are no secrets to update, we might need to clear existing ones
  # To avoid accidental removal, this script will not clear secrets.
  # Use `gcloud run services update ... --clear-secrets` manually if needed.
  :
fi
if [[ "${#env_keys[@]}" -gt 0 ]]; then
  remove_secrets_arg="$(IFS=,; echo "${env_keys[*]}")"
  gcloud run services update "$SERVICE_NAME" --region "$REGION" ${project_id:+--project "$project_id"} --remove-secrets "$remove_secrets_arg"
fi
remove_env_keys=()
for key in FIRESTORE_EMULATOR_HOST GOOGLE_APPLICATION_CREDENTIALS; do
  if should_ignore_key "$key"; then
    remove_env_keys+=("$key")
  fi
done
if [[ "${#remove_env_keys[@]}" -gt 0 ]]; then
  remove_env_arg="$(IFS=,; echo "${remove_env_keys[*]}")"
  cmd+=(--remove-env-vars "$remove_env_arg")
fi

echo "Configuring Cloud Run service environment..."
echo "  Service: $SERVICE_NAME"
echo "  Region: $REGION"
echo "  Env file: $ENV_FILE"
echo "  Env vars:"
for pair in "${env_pairs[@]}"; do
  echo "    $(display_env_pair "$pair")"
done
if [[ -n "$SECRETS_FILE" ]]; then
  echo "  Secrets file: $SECRETS_FILE"
fi
if [[ -n "$secrets_arg" ]]; then
  echo "  Secrets mapped: ${#secret_map[@]}"
fi

"${cmd[@]}"
