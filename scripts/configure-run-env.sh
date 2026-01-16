#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=""
SECRETS_FILE="${SECRETS_FILE:-}"
SERVICE_NAME="${SERVICE_NAME:-travel-itinerary-app}"
REGION="${REGION:-us-east5}"
IGNORE_KEYS="${IGNORE_KEYS:-PORT,FIRESTORE_EMULATOR_HOST}"
SECRETS="${SECRETS:-}"

usage() {
  echo "Usage: $0 [path/to/.env]" >&2
  echo "Configures Cloud Run env vars and Secret Manager mappings without deploying code." >&2
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
  if [[ -f "server/.env" ]]; then
    ENV_FILE="server/.env"
  elif [[ -f ".env" ]]; then
    ENV_FILE=".env"
  else
    echo "No .env file found. Provide one as the first argument." >&2
    exit 1
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

if [[ "$(basename "$ENV_FILE")" == ".local_env" ]]; then
  echo "Refusing to configure using .local_env (local-only values should not be uploaded)." >&2
  exit 1
fi

if [[ -z "$SECRETS_FILE" ]]; then
  if [[ -f "server/.secrets" ]]; then
    SECRETS_FILE="server/.secrets"
  elif [[ -f ".secrets" ]]; then
    SECRETS_FILE=".secrets"
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
project_id=""

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%$''}"
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
  if [[ "$key" == "GCLOUD_PROJECT_ID" || "$key" == "GOOGLE_CLOUD_PROJECT" ]]; then
    project_id="$value"
  fi
  value="${value//,/\\,}"
  env_pairs+=("${key}=${value}")
done < "$ENV_FILE"

if [[ "${#env_pairs[@]}" -eq 0 ]]; then
  echo "No env vars parsed from $ENV_FILE." >&2
  exit 1
fi

env_arg="$(IFS=,; echo "${env_pairs[*]}")"

declare -A secret_map=()
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
    line="${line%%$''}"
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
    [[ -z "$key" ]] && continue
    if ! gcloud secrets describe "$key" ${project_id:+"--project" "$project_id"} >/dev/null 2>&1; then
      gcloud secrets create "$key" --replication-policy=automatic ${project_id:+"--project" "$project_id"}
    fi
    printf '%s' "$value" | gcloud secrets versions add "$key" --data-file=-
    if [[ -z "${secret_map[$key]:-}" ]]; then
      secret_map["$key"]="$key:latest"
    fi
  done < "$SECRETS_FILE"
fi

secrets_arg=""
if [[ "${#secret_map[@]}" -gt 0 ]]; then
  secret_pairs=()
  for key in "${!secret_map[@]}"; do
    secret_pairs+=("${key}=${secret_map[$key]}")
  done
  secrets_arg="$(IFS=,; echo "${secret_pairs[*]}")"
fi

cmd=(gcloud run services update "$SERVICE_NAME" --region "$REGION" --update-env-vars "$env_arg")
if [[ -n "$project_id" ]]; then
  cmd+=(--project "$project_id")
fi
if [[ -n "$secrets_arg" ]]; then
  cmd+=(--update-secrets "$secrets_arg")
else
  # If there are no secrets to update, we might need to clear existing ones
  # To avoid accidental removal, this script will not clear secrets.
  # Use `gcloud run services update ... --clear-secrets` manually if needed.
  :
fi

echo "Configuring Cloud Run service environment..."
echo "  Service: $SERVICE_NAME"
echo "  Region: $REGION"
echo "  Env file: $ENV_FILE"
if [[ -n "$SECRETS_FILE" ]]; then
  echo "  Secrets file: $SECRETS_FILE"
fi
if [[ -n "$secrets_arg" ]]; then
  echo "  Secrets mapped: ${#secret_map[@]}"
fi

"${cmd[@]}"