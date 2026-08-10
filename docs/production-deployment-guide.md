# Production Deployment Guide

This guide covers the scripted Phase 11 deployment path:

- deploy to the isolated test environment
- promote the tested release to production
- bypass directly to production for emergencies
- roll back production to a manifest-paired frontend/backend release
- tear down old 0%-traffic production revisions

The scripts are the source of truth. The GitHub Actions workflows call the
bash (`.sh`) versions with `workflow_dispatch` inputs (CI runs on
`ubuntu-latest`).

Every script also has a `.ps1` counterpart for running these operations
locally from PowerShell on Windows without Git Bash or WSL — same flags
(PowerShell-cased), same behavior, both delegate manifest/evidence
validation and the `configFingerprint` hash to the same
`scripts/lib/phase11-validators.js` so a manifest built in one shell
validates identically in the other. All examples below are given in bash;
swap `bash scripts/x.sh --flag value` for `.\scripts\x.ps1 -Flag value`
(e.g. `--dry-run` → `-DryRun`, `--release-manifest <path>` →
`-ReleaseManifest <path>`).

## Automatic Deploy on Push to Main

Independent of the scripted Phase 11 pipeline described in the rest of this
guide, **any push to `main` immediately and automatically deploys to
production**, with no approval gate, no test-environment pass, and no
canary:

- `.github/workflows/deploy-api.yml` builds the backend straight from the
  pushed `server/` source (`gcloud run deploy --source .`) and deploys it to
  the `travel-itinerary-app` Cloud Run service in `us-east5`, then runs
  `gcloud run services update-traffic ... --to-latest` — 100% of traffic
  moves to the new revision immediately.
- `.github/workflows/firebase-hosting-merge.yml` runs
  `npm --prefix app run export:web` and deploys the result to Firebase
  Hosting (`travel-itinerary-app-483623`), also with no approval gate.
- `.github/workflows/ci.yml` (typecheck/test/expo-doctor) also runs on the
  same push, but it's a separate workflow — it does not block or gate either
  deploy workflow above. A push with failing tests still deploys.

**Practical implication:** merging or pushing to `main` is itself a
production deploy action for both the API and the web frontend, regardless
of whether anyone runs any of the `scripts/deploy-*` commands below. There is
currently no branch-protection rule wired to block this at the infrastructure
level — GitHub will warn ("Changes must be made through a pull request") if
the repo's ruleset requires PRs, but an account with bypass permission can
still push directly to `main` and both deploys will fire.

Use this fast path only when you specifically want an immediate, full-traffic
release. For anything you want staged through a test environment, a canary
smoke test, and a rollback-ready manifest/evidence pair, use the Phase 11
pipeline documented below instead — and be aware that landing that same
commit on `main` (e.g. via a PR merge) will *also* trigger this automatic
deploy at the same time, in parallel with whatever the Phase 11 scripts are
doing.

## One-Time Setup

1. Create the real deployment config:

   **Bash:**
   ```bash
   cp scripts/deploy.config.example scripts/deploy.config
   ```

   **PowerShell:**
   ```powershell
   copy scripts\deploy.config.example scripts\deploy.config
   ```

2. Fill in every value in `scripts/deploy.config`.

   Required values include test/prod Cloud Run services, regions, Firebase
   Hosting sites, domains, Firestore database IDs, runtime service accounts,
   AI capture buckets, Artifact Registry repo, and rollback retention days.

3. Complete the manual cloud prerequisites:

   - test Firestore database, separate from production
   - test Cloud Run service
   - test Firebase Hosting site and DNS
   - test runtime service account
   - separate low-budget test vendor/API secrets

4. Set `CANARY_ACCOUNT_EMAIL` (server env var) and `DEPLOY_WORKER_SHARED_SECRET`
   (server env var) on the production Cloud Run service, matching the same
   two values in `scripts/deploy.config`. The server bootstraps the canary
   account automatically on startup — with `is_internal_canary: true` — the
   first time it sees `CANARY_ACCOUNT_EMAIL` set; there is no manual account
   creation step. `DEPLOY_WORKER_SHARED_SECRET` authorizes the deploy
   scripts' calls to the server's internal `/api/internal/deploy/*`
   endpoints (canary smoke write/cleanup, durable audit_log writes).

5. Configure GitHub environments:

   - `test`
   - `production` with required manual approval

6. Configure GitHub secrets used by the workflows:

   - `GCP_SERVICE_ACCOUNT_KEY`
   - `GCLOUD_PROJECT_ID`
   - `DEPLOY_WORKER_SHARED_SECRET` (same value as the server env var above)

## Local Dry Runs

Dry runs validate script wiring and manifest/evidence handling without touching
GCP or Firebase:

**Bash:**
```bash
DEPLOY_CONFIG_FILE=scripts/deploy.config.example \
  bash scripts/build-release.sh --dry-run --output-dir dist/phase11-dryrun

bash scripts/deploy-test.sh --dry-run \
  --release-manifest dist/phase11-dryrun/release-manifest-<sha>.json

bash scripts/cutover-test-to-prod.sh --dry-run \
  --release-manifest dist/phase11-dryrun/release-manifest-<sha>.json \
  --test-evidence dist/release/release-test-evidence-release-manifest-<sha>.json

bash scripts/deploy-prod.sh --dry-run \
  --reason "Emergency config-only validation"
```

**PowerShell:**
```powershell
$env:DEPLOY_CONFIG_FILE="scripts/deploy.config.example"
.\scripts\build-release.ps1 -DryRun -OutputDir dist/phase11-dryrun

.\scripts\deploy-test.ps1 -DryRun `
  -ReleaseManifest dist/phase11-dryrun/release-manifest-<sha>.json

.\scripts\cutover-test-to-prod.ps1 -DryRun `
  -ReleaseManifest dist/phase11-dryrun/release-manifest-<sha>.json `
  -TestEvidence dist/release/release-test-evidence-release-manifest-<sha>.json

.\scripts\deploy-prod.ps1 -DryRun `
  -Reason "Emergency config-only validation"
```

## Deploy to Test

Preferred operator path: run GitHub workflow **Production Path - Deploy Test**.

Inputs:

- `reseed`: `true` only when synthetic fixture data should be recreated
- `release_manifest`: optional path if reusing an existing manifest

Equivalent script:

**Bash:**
```bash
bash scripts/deploy-test.sh --reseed
```

**PowerShell:**
```powershell
.\scripts\deploy-test.ps1 -Reseed
```

What the script does:

1. Builds a release manifest via `scripts/build-release.sh`, unless one is supplied.
2. Validates environment isolation.
3. Deploys the digest-pinned backend image to the test Cloud Run service.
4. Deploys the manifest-paired frontend artifact to the test Hosting site.
5. Deploys Firestore indexes to the test database.
6. Runs `scripts/smoke-test.sh`.
7. Writes immutable `release-test-evidence-*.json`.

Keep both files from the workflow artifact:

- `release-manifest-*.json`
- `release-test-evidence-*.json`

## Promote Test to Production

Preferred operator path: run GitHub workflow **Production Path - Cutover**.

Inputs:

- `release_manifest`: manifest produced by the test deploy
- `test_evidence`: evidence produced by the test deploy
- `staged`: optional staged traffic shift

Equivalent script:

**Bash:**
```bash
bash scripts/cutover-test-to-prod.sh \
  --release-manifest dist/release/release-manifest-<sha>.json \
  --test-evidence dist/release/release-test-evidence-release-manifest-<sha>.json
```

GITHUB_ACTOR can be "Bryan" or "Tristan"
**PowerShell:**
```powershell
$env:GITHUB_ACTOR = "Bryan"
.\scripts\cutover-test-to-prod.ps1 `
  -ReleaseManifest dist/release/release-manifest-<sha>.json `
  -TestEvidence dist/release/release-test-evidence-release-manifest-<sha>.json
```

What the script does before touching production:

1. Requires an authorized `GITHUB_ACTOR` unless `--dry-run` is used.
2. Validates the manifest shape.
3. Validates test evidence matches the manifest backend digest, frontend SHA,
   and config fingerprint (file-to-file consistency).
4. **Verifies against live infrastructure**, not just the files: confirms the
   digest recorded in the manifest is what's actually deployed to
   `TEST_SERVICE_NAME` right now, fetches `deploy-marker.json` from the live
   test Hosting site and confirms its `gitSha` matches the manifest, and
   recomputes `configFingerprint` from the deploy config cutover is about to
   use (catching drift since the build, not just drift the evidence file
   happens to record).
5. Prepares the exact frontend artifact referenced by the manifest.

Production actions:

1. Deploys the digest-pinned backend image as a candidate Cloud Run revision
   (`--no-traffic --tag candidate`).
2. Writes a small canary-account record via the candidate revision's own
   tagged URL, then smoke-tests **that candidate URL** (not the public
   production domain, which still serves the outgoing revision at this
   point) against production's real database.
3. Shifts traffic to the candidate.
4. Deploys the manifest-paired frontend artifact to production Hosting.
5. Runs smoke checks against the public production domain.
6. Deletes the canary record created in step 2, regardless of whether step 5
   passed, so the canary account's data footprint never grows across
   cutovers.
7. Writes cutover evidence under `dist/release` and to the `audit_log` table
   via the internal deploy API (best-effort — a failed audit write logs a
   warning but does not fail the cutover).

## Direct to Production

Use only for emergency hotfixes or config-only bypasses. Preferred operator
path: run GitHub workflow **Production Path - Direct Deploy**.

Inputs:

- `reason`: required, human-readable emergency reason
- `release_manifest`: optional existing manifest

Equivalent script:

**Bash:**
```bash
bash scripts/deploy-prod.sh \
  --reason "Emergency production hotfix for <issue>"
```

**PowerShell:**
```powershell
.\scripts\deploy-prod.ps1 `
  -Reason "Emergency production hotfix for <issue>"
```

The script requires:

- `--reason`
- authorized `GITHUB_ACTOR` unless `--dry-run`
- production deployment config values

It prints a bypass warning, deploys the digest-pinned backend, deploys the
manifest-paired frontend artifact, smoke-tests the public production domain,
and writes direct-deploy evidence both to `dist/release` and to the
`audit_log` table via the internal deploy API.

## Rollback

Preferred operator path: run GitHub workflow **Production Path - Rollback**.

Inputs:

- `release_manifest`: manifest paired to the target rollback revision
- `revision`: Cloud Run revision to receive 100% traffic

Equivalent script:

**Bash:**
```bash
bash scripts/rollback.sh \
  --release-manifest dist/release/release-manifest-<sha>.json \
  --revision travel-itinerary-app-00042-abc
```

**PowerShell:**
```powershell
.\scripts\rollback.ps1 `
  -ReleaseManifest dist/release/release-manifest-<sha>.json `
  -Revision travel-itinerary-app-00042-abc
```

Rollback never calls bare Firebase Hosting rollback. It deploys the frontend
artifact from the same release manifest as the backend revision, and refuses
to proceed if the target `--revision`'s live image digest does not match
`--release-manifest`'s `backendImageDigest` — this catches a mistyped
revision/manifest pairing before it recreates the version-mismatch problem
the unified script exists to prevent.

## Teardown Old Production Revisions

Preferred operator path: run GitHub workflow **Production Path - Teardown Old
Revisions**.

Input:

- `confirm`: must be `yes-delete`

Equivalent script:

**Bash:**
```bash
bash scripts/teardown-old-production.sh --confirm yes-delete
```

**PowerShell:**
```powershell
.\scripts\teardown-old-production.ps1 -Confirm yes-delete
```

The script refuses to run without typed confirmation, skips revisions that
have nonzero traffic, and skips revisions younger than
`ROLLBACK_RETENTION_DAYS` — only revisions that are both 0%-traffic and past
the retention window are deleted.

## Current State

Use this before and after deploy operations:

**Bash:**
```bash
bash scripts/current-state.sh
```

**PowerShell:**
```powershell
.\scripts\current-state.ps1
```

It prints current Cloud Run state for test and production, including the
deployed image digest and the `app-git-sha` label set at deploy time.

## Required Validation Before Production

Run these locally or rely on CI before a real production operation:

```bash
npm run typecheck
npm --prefix server run test:single -- --runInBand __tests__/deploy __tests__/middleware/canarySafeMode.test.ts
```

For app/native confidence, also run:

```bash
npm --prefix app run export:web
npm --prefix app run typecheck
```

Native iOS/Android artifacts are built through EAS workflows, not directly by
these server/frontend cutover scripts.

## Quick PowerShell Checklist: Test Then Production

Run these commands from the repository root in PowerShell. Replace `Bryan`
with `Tristan` if that is the authorized deployment actor. The test command
builds the release and writes the manifest and test evidence under
`dist\release`; the final command promotes that same tested manifest to
production.

```powershell
Set-Location 'C:\Git\Tristan\Travel-Itinerary-App'
$env:GITHUB_ACTOR = 'Bryan'

# Optional: inspect the currently deployed test and production revisions.
.\scripts\current-state.ps1

# Deploy a new build to the isolated test environment and run its smoke tests.
# Add -Reseed only when synthetic test data should be recreated.
.\scripts\deploy-test.ps1

# Find the evidence produced by the test deployment and derive its paired manifest.
$evidence = Get-ChildItem -LiteralPath '.\dist\release' -Filter 'release-test-evidence-*.json' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $evidence) { throw 'No test evidence file was found in dist\release.' }

$testEvidence = $evidence.FullName
$manifestName = $evidence.BaseName -replace '^release-test-evidence-', ''
$releaseManifest = Join-Path $evidence.DirectoryName ($manifestName + '.json')
if (-not (Test-Path -LiteralPath $releaseManifest)) {
  throw "Paired release manifest was not found: $releaseManifest"
}

Write-Host "Release manifest: $releaseManifest"
Write-Host "Test evidence:    $testEvidence"

# Promote the exact release that passed test validation to production.
.\scripts\cutover-test-to-prod.ps1 `
  -ReleaseManifest $releaseManifest `
  -TestEvidence $testEvidence

# Optional: confirm the final Cloud Run state and deployed git SHA.
.\scripts\current-state.ps1
```

For an emergency direct production deployment that intentionally bypasses
test cutover, use this only with a specific reason:

```powershell
Set-Location 'C:\Git\Tristan\Travel-Itinerary-App'
$env:GITHUB_ACTOR = 'Bryan'
.\scripts\deploy-prod.ps1 -Reason 'Emergency production hotfix for <issue>'
```
