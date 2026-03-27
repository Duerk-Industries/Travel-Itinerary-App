#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=""
SKIP_LOGIN=0

usage() {
  echo "Usage: $0 [--skip-login] [path/to/.env]" >&2
  echo "Runs configure-gcloud, enable-gcp-apis, configure-gcp-iam, and configure-run-env." >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-login)
      SKIP_LOGIN=1
      shift
      ;;
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

if [[ -n "$ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

trim() {
  local input="$1"
  input="${input#"${input%%[![:space:]]*}"}"
  input="${input%"${input##*[![:space:]]}"}"
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
    if [[ "$ch" == "\\" ]]; then
      out+="$ch"
      escaped=1
      continue
    fi
    if [[ "$ch" == "'" && $in_double -eq 0 ]]; then
      ((in_single = 1 - in_single))
      out+="$ch"
      continue
    fi
    if [[ "$ch" == "\"" && $in_single -eq 0 ]]; then
      ((in_double = 1 - in_double))
      out+="$ch"
      continue
    fi
    if [[ "$ch" == "#" && $in_single -eq 0 && $in_double -eq 0 ]]; then
      prev="${line:$((i-1)):1}"
      if [[ $i -eq 0 || "$prev" == " " || "$prev" == $'\t' ]]; then
        break
      fi
    fi
    out+="$ch"
  done
  printf '%s' "$out"
}

PROJECT_ID="${GCLOUD_PROJECT_ID:-}"

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
  key="$(trim "${line%%=*}")"
  value="$(trim "${line#*=}")"
  if [[ "$value" =~ ^\".*\"$ || "$value" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi
  if [[ "$key" == "GCLOUD_PROJECT_ID" && -z "$PROJECT_ID" ]]; then
    PROJECT_ID="$value"
  fi
done < "$ENV_FILE"

if [[ -z "$PROJECT_ID" && -f "server/.secrets" ]]; then
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
    key="$(trim "${line%%=*}")"
    value="$(trim "${line#*=}")"
    if [[ "$value" =~ ^\".*\"$ || "$value" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    if [[ "$key" == "GCLOUD_PROJECT_ID" && -z "$PROJECT_ID" ]]; then
      PROJECT_ID="$value"
    fi
  done < "server/.secrets"
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "GCLOUD_PROJECT_ID is required (set env or add to server/.env; server/.secrets is still supported as a fallback)." >&2
  exit 1
fi

if [[ "$SKIP_LOGIN" != "1" ]]; then
  ./scripts/configure-gcloud.sh "$PROJECT_ID"
fi

./scripts/enable-gcp-apis.sh
./scripts/configure-gcp-iam.sh "${ENV_FILE:-}"
./scripts/configure-run-env.sh "${ENV_FILE:-}"

echo "Setup completed."
