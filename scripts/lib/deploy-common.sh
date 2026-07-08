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
  local value
  value="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const value=process.argv[2].split('.').reduce((o,k)=>o==null?undefined:o[k], data); if (value == null) process.exit(2); process.stdout.write(String(value));" "$file" "$expr")" \
    || fail "JSON property '$expr' not found in $file"
  printf '%s' "$value"
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

# Builds the same scoped Content-Security-Policy shape as the repo's
# firebase.json (see that file), parameterized by host, so test/cutover/
# rollback/direct-prod deploys never fall back to the more permissive
# generic policy that was previously hardcoded here.
write_hosting_config() {
  local output_file="$1"
  local site="$2"
  local public_dir="$3"
  local service_name="$4"
  local region="$5"
  local domain_url="$6"
  node - "$output_file" "$site" "$public_dir" "$service_name" "$region" "$domain_url" <<'NODE'
const fs = require('fs');
const [outputFile, site, publicDir, serviceId, region, domainUrl] = process.argv.slice(2);
const host = String(domainUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
if (!host) {
  console.error('write_hosting_config: domain_url is required to scope the CSP');
  process.exit(1);
}
const csp = [
  `default-src 'self' https://${host}`,
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.gstatic.com https://www.google.com`,
  `connect-src 'self' https://www.gstatic.com https://www.google.com https://${host} wss://${host} https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com`,
  `img-src 'self' https://${host} https://images.unsplash.com data: blob: https://www.gstatic.com https://www.google.com https://maps.googleapis.com https://maps.gstatic.com https://storage.googleapis.com https://places.googleapis.com`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com`,
  `frame-src 'self' https://www.google.com https://recaptcha.google.com`,
  `worker-src 'self' blob:`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join('; ') + ';';
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
        headers: [{ key: 'Content-Security-Policy', value: csp }],
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

# All Phase 11 scripts must go through this helper rather than calling a bare
# `firebase` binary, which is not preinstalled on GitHub-hosted runners (the
# repo's existing firebase-hosting-*.yml workflows use the same npx pattern).
firebase_deploy_hosting() {
  local config_file="$1"
  local site="$2"
  local project_args=()
  if [[ -n "${GCLOUD_PROJECT_ID:-}" ]]; then
    project_args=(--project "$GCLOUD_PROJECT_ID")
  fi
  npx --yes firebase-tools deploy --config "$config_file" --only "hosting:$site" --non-interactive "${project_args[@]}"
}

# Returns the container image reference (with digest, when Cloud Run reports
# one) currently deployed to a Cloud Run service's latest ready revision.
live_service_image() {
  local service="$1"
  local region="$2"
  gcloud run services describe "$service" --region "$region" --format='value(spec.template.spec.containers[0].image)'
}

# Returns the URL Cloud Run assigned to a specific traffic tag (e.g. the
# "candidate" tag set by `gcloud run deploy --tag candidate`), so smoke tests
# can target the actual new revision instead of the service's public URL,
# which still points at the previous revision until traffic is shifted.
tagged_revision_url() {
  local service="$1"
  local region="$2"
  local tag="$3"
  gcloud run services describe "$service" --region "$region" --format=json \
    | node -e "const s=JSON.parse(require('fs').readFileSync(0,'utf8')); const tag=process.argv[1]; const entry=(s.status.traffic||[]).find(t=>t.tag===tag); if(!entry||!entry.url){process.exit(2);} process.stdout.write(entry.url);" "$tag"
}

# Writes the deploy audit trail through the internal deploy API instead of
# only a local JSON file, so cutover/rollback/teardown/direct-deploy
# operations show up in the same audit_log every other privileged action in
# this codebase uses. Best-effort: logs a warning and continues rather than
# failing the whole operation if the audit call itself fails.
write_deploy_audit_log() {
  local action="$1"
  local reason="$2"
  local release_manifest="$3"
  local details_json="${4:-{\}}"
  if [[ -z "${DEPLOY_AUDIT_API_URL:-}" || -z "${DEPLOY_WORKER_SHARED_SECRET:-}" ]]; then
    echo "WARNING: DEPLOY_AUDIT_API_URL/DEPLOY_WORKER_SHARED_SECRET not set; skipping durable audit_log write for $action" >&2
    return 0
  fi
  curl -sS -o /dev/null -w '%{http_code}' -X POST "$DEPLOY_AUDIT_API_URL/audit-log" \
    -H "X-Deploy-Worker-Secret: $DEPLOY_WORKER_SHARED_SECRET" \
    -H 'Content-Type: application/json' \
    -d "$(node -e "console.log(JSON.stringify({action: process.argv[1], reason: process.argv[2], actor: process.env.GITHUB_ACTOR || 'local', releaseManifest: process.argv[3], details: JSON.parse(process.argv[4])}))" "$action" "$reason" "$release_manifest" "$details_json")" \
    | grep -q '^2' || echo "WARNING: audit_log write for $action did not return 2xx" >&2
}
