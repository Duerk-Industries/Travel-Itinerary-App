#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-travel-itinerary-app}"
REGION="${REGION:-us-east5}"
SOURCE_DIR="${SOURCE_DIR:-server}"
ENV_FILE="${ENV_FILE:-}"
IGNORE_KEYS="${IGNORE_KEYS:-PORT,FIRESTORE_EMULATOR_HOST,GCLOUD_PROJECT_ID,GCLOUD_PROJECT_NUMBER,DEPLOYER_SERVICE_ACCOUNT_EMAIL,RUNTIME_SERVICE_ACCOUNT_EMAIL,CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,FIRESTORE_DATABASE_ID}"

# This script deploys the API code and updates non-secret env vars from .env.
# Use ./scripts/configure-run-env.sh to manage secrets.

echo "Deploying Cloud Run service source code..."
echo "  Service: $SERVICE_NAME"
echo "  Region: $REGION"
echo "  Source: $SOURCE_DIR"

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f "server/.env" ]]; then
    ENV_FILE="server/.env"
  elif [[ -f ".env" ]]; then
    ENV_FILE=".env"
  fi
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

env_pairs=()
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

env_arg=""
if [[ "${#env_pairs[@]}" -gt 0 ]]; then
  env_arg="$(IFS=,; echo "${env_pairs[*]}")"
  echo "Non-secret env vars to upload:"
  for pair in "${env_pairs[@]}"; do
    echo "  $pair"
  done
fi

gcloud run deploy "$SERVICE_NAME" \
  --source "$SOURCE_DIR" \
  --region "$REGION" \
  ${env_arg:+--update-env-vars "$env_arg"}

echo "API deployment completed."
