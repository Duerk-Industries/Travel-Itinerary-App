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

prepare_frontend_from_manifest() {
  local manifest="$1"
  local output_dir="$2"
  local frontend_artifact
  local expected_sha
  frontend_artifact="$(json_get "$manifest" frontendArtifact)"
  expected_sha="$(json_get "$manifest" frontendSha256)"
  rm -rf "$output_dir"
  mkdir -p "$output_dir"
  local actual_sha
  actual_sha="$(sha256_file "$frontend_artifact")"
  [[ "$actual_sha" == "$expected_sha" ]] || fail "Frontend artifact checksum mismatch"
  tar -xzf "$frontend_artifact" -C "$output_dir"
}

write_hosting_config() {
  local output_file="$1"
  local site="$2"
  local public_dir="$3"
  local service_name="$4"
  local region="$5"
  node - "$output_file" "$site" "$public_dir" "$service_name" "$region" <<'NODE'
const fs = require('fs');
const [outputFile, site, publicDir, serviceId, region] = process.argv.slice(2);
const config = {
  hosting: {
    site,
    public: publicDir,
    ignore: ['firebase.json', '**/.*', '**/node_modules/**'],
    headers: [
      {
        source: '/index.html',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
      {
        source: '**',
        headers: [{
          key: 'Content-Security-Policy',
          value: "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; connect-src 'self' https: wss:;",
        }],
      },
    ],
    rewrites: [
      { source: '/api/**', run: { serviceId, region } },
      { source: '/socket.io/**', run: { serviceId, region } },
      { source: '**', destination: '/index.html' },
    ],
  },
};
fs.writeFileSync(outputFile, JSON.stringify(config, null, 2) + '\n');
NODE
}
