#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

PORTS=(4001 8080 9099 9199 5001 5000)

is_port_open() {
  local port="$1"
  if command -v timeout >/dev/null 2>&1; then
    timeout 1 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1
  else
    bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1
  fi
}

OPEN_PORT=""
for port in "${PORTS[@]}"; do
  if is_port_open "$port"; then
    OPEN_PORT="$port"
    break
  fi
done

if [[ -n "$OPEN_PORT" ]]; then
  echo "Firebase emulators appear to be running (port ${OPEN_PORT} is accepting connections)."
  exit 0
fi

if command -v firebase >/dev/null 2>&1; then
  FIREBASE_CMD=(firebase)
elif command -v npx >/dev/null 2>&1; then
  FIREBASE_CMD=(npx firebase)
else
  echo "firebase CLI not found. Install firebase-tools or ensure npx is available."
  exit 1
fi

echo "Firebase emulators not detected. Starting..."
exec "${FIREBASE_CMD[@]}" emulators:start --import=./.firebase-data --export-on-exit=./.firebase-data
