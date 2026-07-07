#!/usr/bin/env bash
set -euo pipefail

DEPLOY_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_COMMON_DIR/../.." && pwd)"
DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-$REPO_ROOT/scripts/deploy.config}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

load_deploy_config() {
  local config_path="${1:-$DEPLOY_CONFIG_FILE}"
  if [[ ! -f "$config_path" ]]; then
    fail "Deploy config not found: $config_path. Copy scripts/deploy.config.example to scripts/deploy.config."
  fi
  set -a
  # shellcheck disable=SC1090
  source "$config_path"
  set +a
}

require_vars() {
  local missing=()
  local name
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    fail "Missing required deploy config values: ${missing[*]}"
  fi
}

bool_is_true() {
  [[ "${1:-}" == "1" || "${1:-}" == "true" || "${1:-}" == "yes" ]]
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

json_get() {
  local file="$1"
  local expr="$2"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const value=process.argv[2].split('.').reduce((o,k)=>o==null?undefined:o[k], data); if (value == null) process.exit(2); process.stdout.write(String(value));" "$file" "$expr"
}

write_log_json() {
  local file="$1"
  shift
  mkdir -p "$(dirname "$file")"
  node - "$file" "$@" <<'NODE'
const fs = require('fs');
const [file, ...pairs] = process.argv.slice(2);
const data = {};
for (const pair of pairs) {
  const index = pair.indexOf('=');
  if (index === -1) continue;
  data[pair.slice(0, index)] = pair.slice(index + 1);
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
NODE
}

render_template() {
  local template="$1"
  local output="$2"
  node - "$template" "$output" <<'NODE'
const fs = require('fs');
const [template, output] = process.argv.slice(2);
let text = fs.readFileSync(template, 'utf8');
for (const [key, value] of Object.entries(process.env)) {
  text = text.replaceAll(`{{${key}}}`, value);
}
fs.writeFileSync(output, text);
NODE
}
