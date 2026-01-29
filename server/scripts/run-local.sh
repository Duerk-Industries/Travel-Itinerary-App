#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SERVER_DIR}/.." && pwd)"

usage() {
  echo "Usage: $(basename "$0") [--clean]"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

CLEAN_LOGS=0
if [[ "${1:-}" == "--clean" ]]; then
  CLEAN_LOGS=1
  shift
fi

if [[ $# -gt 0 ]]; then
  echo "Unknown option: $1"
  usage
  exit 1
fi

read_env_value() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  awk -F= -v k="$key" '
    $0 ~ "^[[:space:]]*"k"[[:space:]]*=" {
      val=$0
      sub(/^[^=]*=/,"",val)
      sub(/[[:space:]]*(#.*)?$/,"",val)
      gsub(/^[[:space:]]+|[[:space:]]+$/,"",val)
      gsub(/^["'"'"']|["'"'"']$/,"",val)
      print val
    }
  ' "$file" | tail -n 1
}

LOCAL_ENV_FILE=""
if [[ -f "${SERVER_DIR}/.local_env" ]]; then
  LOCAL_ENV_FILE="${SERVER_DIR}/.local_env"
elif [[ -f "${ROOT_DIR}/.local_env" ]]; then
  LOCAL_ENV_FILE="${ROOT_DIR}/.local_env"
fi

if [[ -z "$LOCAL_ENV_FILE" ]]; then
  echo "Missing .local_env file. Create ${SERVER_DIR}/.local_env or ${ROOT_DIR}/.local_env."
  exit 1
fi

RUN_LOCAL_VALUE="$(read_env_value "$LOCAL_ENV_FILE" "RUN_LOCAL")"
if [[ "$RUN_LOCAL_VALUE" != "1" ]]; then
  echo "RUN_LOCAL is not set to 1 in ${LOCAL_ENV_FILE}. Aborting."
  exit 1
fi

ENV_FILE="${SERVER_DIR}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${SERVER_DIR}/.env file."
  exit 1
fi

DB_PROVIDER="$(read_env_value "$ENV_FILE" "DB_PROVIDER")"
DB_PROVIDER="${DB_PROVIDER,,}"

LOG_DIR="${SERVER_DIR}/logs"
if [[ $CLEAN_LOGS -eq 1 ]]; then
  if [[ -d "$LOG_DIR" ]]; then
    find "$LOG_DIR" -maxdepth 1 -type f -print -delete
  fi
fi

is_emulator_running() {
  local hostport="$1"
  local host="${hostport%:*}"
  local port="${hostport##*:}"

  if [[ -n "${BASH_VERSION:-}" ]]; then
    (exec 3<>"/dev/tcp/${host}/${port}") >/dev/null 2>&1
    return $?
  fi

  if command -v nc >/dev/null 2>&1; then
    nc -z "$host" "$port" >/dev/null 2>&1
    return $?
  fi

  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null --max-time 2 "http://${hostport}"
    return $?
  fi

  return 1
}

is_port_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"; then
      return 0
    fi
  fi

  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v netstat >/dev/null 2>&1; then
    if netstat -an 2>/dev/null | awk '{print $4,$6}' | grep -Eq "(^|:)$port[[:space:]]+LISTENING$|(^|:)$port[[:space:]]+LISTEN$"; then
      return 0
    fi
  fi

  if command -v powershell.exe >/dev/null 2>&1; then
    if powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort $port) { exit 0 } else { exit 1 }" >/dev/null 2>&1; then
      return 0
    fi
  fi

  return 1
}

EMULATOR_PID=""
NODE_SHIM_DIR=""
FIREBASE_CMD=""
if [[ "$DB_PROVIDER" == "firebase" ]]; then
  if command -v firebase >/dev/null 2>&1; then
    if firebase --version >/dev/null 2>&1; then
      FIREBASE_CMD="firebase"
    fi
  fi
  if [[ -z "$FIREBASE_CMD" ]]; then
    if command -v npx >/dev/null 2>&1; then
      FIREBASE_CMD="npx --yes firebase-tools"
    else
      echo "firebase CLI not available and npx not found. Install Node.js and firebase-tools."
      exit 1
    fi
  fi

  if ! command -v node >/dev/null 2>&1; then
    for candidate in \
      "/mnt/c/Program Files/nodejs/node.exe" \
      "/mnt/c/Program Files (x86)/nodejs/node.exe" \
      "/mnt/c/Users/${USER}/AppData/Local/Programs/nodejs/node.exe"
    do
      if [[ -x "$candidate" ]]; then
        NODE_SHIM_DIR="$(mktemp -d)"
        ln -s "$candidate" "${NODE_SHIM_DIR}/node"
        export PATH="${NODE_SHIM_DIR}:${PATH}"
        break
      fi
    done
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to start the Firebase emulator. Install Node.js or add it to PATH."
    exit 1
  fi

  EMULATOR_HOST="$(read_env_value "$LOCAL_ENV_FILE" "FIRESTORE_EMULATOR_HOST")"
  if [[ -z "$EMULATOR_HOST" ]]; then
    EMULATOR_HOST="$(read_env_value "$ENV_FILE" "FIRESTORE_EMULATOR_HOST")"
  fi
  if [[ -z "$EMULATOR_HOST" ]]; then
    EMULATOR_HOST="localhost:8080"
  fi

  if ! is_emulator_running "$EMULATOR_HOST"; then
    if is_port_listening "${EMULATOR_HOST##*:}"; then
      echo "Port ${EMULATOR_HOST##*:} is already in use; assuming Firebase emulator is running."
    else
      echo "Firebase emulator not running on ${EMULATOR_HOST}. Starting..."
    ${FIREBASE_CMD} emulators:start --only firestore &
    EMULATOR_PID=$!

    for _ in {1..20}; do
      if is_emulator_running "$EMULATOR_HOST"; then
        break
      fi
      sleep 0.5
    done

    if ! is_emulator_running "$EMULATOR_HOST"; then
      echo "Firebase emulator failed to start."
      kill "$EMULATOR_PID" >/dev/null 2>&1 || true
      exit 1
    fi
    fi
  fi
fi

cleanup() {
  if [[ -n "$EMULATOR_PID" ]]; then
    kill "$EMULATOR_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$NODE_SHIM_DIR" ]]; then
    rm -rf "$NODE_SHIM_DIR"
  fi
}
trap cleanup EXIT

echo "Starting API server..."
cd "$SERVER_DIR"
npm run dev
