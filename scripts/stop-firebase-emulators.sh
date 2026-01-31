#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

DATA_DIR="${FIREBASE_DATA_DIR:-./.firebase-data}"
UI_PORT=4001
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

if [[ -z "$OPEN_PORT" ]]; then
  echo "Firebase emulators do not appear to be running."
  exit 0
fi

FIREBASE_CMD=()
if command -v firebase >/dev/null 2>&1; then
  FIREBASE_CMD=(firebase)
elif command -v npx >/dev/null 2>&1; then
  FIREBASE_CMD=(npx firebase)
fi

if [[ ${#FIREBASE_CMD[@]} -gt 0 ]]; then
  echo "Exporting emulator data to ${DATA_DIR}..."
  if ! "${FIREBASE_CMD[@]}" emulators:export --force "$DATA_DIR"; then
    echo "Warning: export failed; attempting graceful shutdown anyway."
  fi
else
  echo "firebase CLI not found; skipping explicit export."
fi

PROJECT_ID="${GCLOUD_PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
if [[ -z "$PROJECT_ID" && -f ".firebaserc" ]]; then
  if command -v node >/dev/null 2>&1; then
    PROJECT_ID="$(node -e "const fs=require('fs');const rc=JSON.parse(fs.readFileSync('.firebaserc','utf8'));const p=(rc.projects&& (rc.projects.default||rc.projects.current||Object.values(rc.projects)[0]))||'';process.stdout.write(p);" 2>/dev/null || true)"
  elif command -v python3 >/dev/null 2>&1; then
    PROJECT_ID="$(python3 - <<'PY'
import json,sys
try:
  rc=json.load(open(".firebaserc","r",encoding="utf-8"))
  projects=rc.get("projects",{}) or {}
  print(projects.get("default") or projects.get("current") or (next(iter(projects.values())) if projects else ""), end="")
except Exception:
  pass
PY
)"
  elif command -v python >/dev/null 2>&1; then
    PROJECT_ID="$(python - <<'PY'
import json,sys
try:
  rc=json.load(open(".firebaserc","r",encoding="utf-8"))
  projects=rc.get("projects",{}) or {}
  print(projects.get("default") or projects.get("current") or (next(iter(projects.values())) if projects else ""), end="")
except Exception:
  pass
PY
)"
  fi
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "Could not determine Firebase project id for graceful shutdown."
  echo "Set GCLOUD_PROJECT_ID or ensure .firebaserc exists."
  exit 1
fi

echo "Sending shutdown signal to Firebase emulators (project ${PROJECT_ID})..."
if command -v curl >/dev/null 2>&1; then
  curl -s -X POST "http://127.0.0.1:${UI_PORT}/emulator/v1/projects/${PROJECT_ID}:shutdown" >/dev/null || true
elif command -v python3 >/dev/null 2>&1; then
  python3 - <<PY
import urllib.request
urllib.request.urlopen("http://127.0.0.1:${UI_PORT}/emulator/v1/projects/${PROJECT_ID}:shutdown", data=b"")
PY
elif command -v python >/dev/null 2>&1; then
  python - <<PY
import urllib.request
urllib.request.urlopen("http://127.0.0.1:${UI_PORT}/emulator/v1/projects/${PROJECT_ID}:shutdown", data=b"")
PY
else
  echo "curl/python not available to call emulator shutdown endpoint."
  exit 1
fi

for _ in {1..40}; do
  if ! is_port_open "$UI_PORT"; then
    echo "Firebase emulators stopped and export should be flushed."
    exit 0
  fi
  sleep 0.5
done

echo "Timed out waiting for Firebase emulators to stop. Check running processes."
exit 1
