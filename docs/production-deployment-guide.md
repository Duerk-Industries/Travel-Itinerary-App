# Production Deployment Guide

This guide covers the scripted Phase 11 deployment path:

- deploy to the isolated test environment
- promote the tested release to production
- bypass directly to production for emergencies
- roll back production to a manifest-paired frontend/backend release
- tear down old 0%-traffic production revisions

The scripts are the source of truth. The GitHub Actions workflows call these
same scripts with `workflow_dispatch` inputs.

## One-Time Setup

1. Create the real deployment config:

   ```bash
   cp scripts/deploy.config.example scripts/deploy.config
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
   - permanent production canary account with `is_internal_canary: true`

4. Configure GitHub environments:

   - `test`
   - `production` with required manual approval

5. Configure GitHub secrets used by the workflows:

   - `GCP_SERVICE_ACCOUNT_KEY`
   - `GCLOUD_PROJECT_ID`

## Local Dry Runs

Dry runs validate script wiring and manifest/evidence handling without touching
GCP or Firebase:

```bash
DEPLOY_CONFIG_FILE=scripts/deploy.config.example \
  bash scripts/build-release.sh --dry-run --output-dir dist/phase11-dryrun
```

```bash
DEPLOY_CONFIG_FILE=scripts/deploy.config.example \
  bash scripts/deploy-test.sh --dry-run \
  --release-manifest dist/phase11-dryrun/release-manifest-<sha>.json
```

```bash
DEPLOY_CONFIG_FILE=scripts/deploy.config.example \
  bash scripts/cutover-test-to-prod.sh --dry-run \
  --release-manifest dist/phase11-dryrun/release-manifest-<sha>.json \
  --test-evidence dist/release/release-test-evidence-release-manifest-<sha>.json
```

```bash
DEPLOY_CONFIG_FILE=scripts/deploy.config.example \
  bash scripts/deploy-prod.sh --dry-run \
  --reason "Emergency config-only validation"
```

## Deploy to Test

Preferred operator path: run GitHub workflow **Production Path - Deploy Test**.

Inputs:

- `reseed`: `true` only when synthetic fixture data should be recreated
- `release_manifest`: optional path if reusing an existing manifest

Equivalent script:

```bash
bash scripts/deploy-test.sh --reseed
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

```bash
bash scripts/cutover-test-to-prod.sh \
  --release-manifest dist/release/release-manifest-<sha>.json \
  --test-evidence dist/release/release-test-evidence-release-manifest-<sha>.json
```

What the script does before touching production:

1. Requires an authorized `GITHUB_ACTOR` unless `--dry-run` is used.
2. Validates the manifest shape.
3. Validates test evidence matches the manifest backend digest, frontend SHA,
   and config fingerprint.
4. Prepares the exact frontend artifact referenced by the manifest.

Production actions:

1. Deploys the digest-pinned backend image as a candidate Cloud Run revision.
2. Runs smoke checks against the candidate.
3. Shifts traffic to the candidate.
4. Deploys the manifest-paired frontend artifact to production Hosting.
5. Runs smoke checks against the public production domain.
6. Writes cutover evidence under `dist/release`.

## Direct to Production

Use only for emergency hotfixes or config-only bypasses. Preferred operator
path: run GitHub workflow **Production Path - Direct Deploy**.

Inputs:

- `reason`: required, human-readable emergency reason
- `release_manifest`: optional existing manifest

Equivalent script:

```bash
bash scripts/deploy-prod.sh \
  --reason "Emergency production hotfix for <issue>"
```

The script requires:

- `--reason`
- authorized `GITHUB_ACTOR` unless `--dry-run`
- production deployment config values

It prints a bypass warning, deploys the digest-pinned backend, deploys the
manifest-paired frontend artifact, and writes direct-deploy evidence.

## Rollback

Preferred operator path: run GitHub workflow **Production Path - Rollback**.

Inputs:

- `release_manifest`: manifest paired to the target rollback revision
- `revision`: Cloud Run revision to receive 100% traffic

Equivalent script:

```bash
bash scripts/rollback.sh \
  --release-manifest dist/release/release-manifest-<sha>.json \
  --revision travel-itinerary-app-00042-abc
```

Rollback never calls bare Firebase Hosting rollback. It deploys the frontend
artifact from the same release manifest as the backend revision.

## Teardown Old Production Revisions

Preferred operator path: run GitHub workflow **Production Path - Teardown Old
Revisions**.

Input:

- `confirm`: must be `yes-delete`

Equivalent script:

```bash
bash scripts/teardown-old-production.sh --confirm yes-delete
```

The script refuses to run without typed confirmation and skips revisions that
have nonzero traffic.

## Current State

Use this before and after deploy operations:

```bash
bash scripts/current-state.sh
```

It prints current Cloud Run state for test and production.

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
