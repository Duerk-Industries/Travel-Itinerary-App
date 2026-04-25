# GCP Email Ingest Setup

This document covers the production setup for travel email ingest after deploying the API to Cloud Run.

It is written for the current deployment flow in [scripts/deploy-api.ps1](/c:/Git/Tristan/Travel-Itinerary-App/scripts/deploy-api.ps1:1), which:

- deploys the `server` source to Cloud Run
- uploads non-secret values from `server/.env`
- maps secrets from `server/.secrets` to Secret Manager
- deploys Firestore indexes unless `SKIP_FIRESTORE_INDEXES=1`

## Overview

There are two email ingest paths in this app:

1. Forwarded mailbox ingest via Mailgun webhook
2. Gmail inbox import via Google OAuth and Gmail read-only access

Both paths enqueue ingestion jobs into the same backend pipeline, and in production that queue defaults to Cloud Run self-calls through the internal worker endpoint.

## Prerequisites

Before setup, make sure you have:

- a deployed Cloud Run service for the API
- a working custom domain or service URL for `BACKEND_URL`
- Firestore configured for the project
- Secret Manager enabled
- a runtime service account with the permissions your app already uses in production
- Mailgun configured for inbound email if you want forwarded mailbox ingest
- a Google Cloud OAuth client if you want Gmail import

## Step 1: Configure Cloud Run Env Vars

The deploy script reads from:

- `server/.env` for regular env vars
- `server/.secrets` for secret-backed env vars

### Required non-secret env vars

These should live in `server/.env` unless you intentionally override them another way:

- `BACKEND_URL`
- `GCLOUD_PROJECT_ID`
- `GOOGLE_CLOUD_PROJECT`
- `FIRESTORE_DATABASE_ID`
- `DB_PROVIDER`
- `USE_IN_MEMORY_DB=0`

### Required secret env vars

These should normally live in `server/.secrets` so `deploy-api.ps1` maps them with `--set-secrets`:

- `INGESTION_WORKER_SHARED_SECRET`
- `INGESTION_ENCRYPTION_SECRET`
- `MAILGUN_WEBHOOK_SIGNING_KEY` for Mailgun ingest
- `GOOGLE_CLIENT_ID` for Gmail import
- `GOOGLE_CLIENT_SECRET` for Gmail import

### Recommended optional env vars

- `GOOGLE_GMAIL_CALLBACK_URL`
  Use this if you want the Gmail callback URL pinned explicitly instead of derived from the request host.
- `INGESTION_WORKER_BASE_URL`
  Use this if the worker should call a different base URL than `BACKEND_URL`.
- `INGESTION_FORWARDING_ADDRESS`
  Use this if you want the user-facing forwarding address and Mailgun fallback recipient to differ from the built-in default.
- `INGESTION_JOB_QUEUE_MODE=cloud_run`
  Production already defaults to this, but setting it explicitly can make debugging easier.

## Step 2: Understand How `deploy-api.ps1` Treats Env Vars

Current behavior:

- `server/.env` values are uploaded with `--update-env-vars`
- `server/.secrets` keys are mapped to Secret Manager as `<KEY>:latest`
- if a key exists in `.secrets`, the matching `.env` value is removed from plain env upload
- `GOOGLE_APPLICATION_CREDENTIALS` is intentionally ignored for Cloud Run deploys
- `AUTH_REDIRECT_URI_ALLOWLIST` is converted from comma-separated to semicolon-separated during deploy
- memory defaults to `1Gi`

Ignored env keys by default:

- `PORT`
- `FIRESTORE_EMULATOR_HOST`
- `GCLOUD_PROJECT_NUMBER`
- `DEPLOYER_SERVICE_ACCOUNT_EMAIL`
- `RUNTIME_SERVICE_ACCOUNT_EMAIL`
- `CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_APPLICATION_CREDENTIALS`

## Step 3: Deploy the API

From the repo root:

```powershell
.\scripts\deploy-api.ps1
```

Optional overrides:

```powershell
$env:MEMORY='2Gi'
.\scripts\deploy-api.ps1
```

If you want to skip Firestore index deploys for a run:

```powershell
$env:SKIP_FIRESTORE_INDEXES='1'
.\scripts\deploy-api.ps1
```

## Step 4: Verify Worker Queue Wiring

In production, ingestion jobs are dispatched to:

- `/api/internal/ingestion/jobs/:jobId/run`

The app calls that endpoint using:

- `INGESTION_WORKER_BASE_URL`, or if unset
- `BACKEND_URL`

The request must include a matching:

- `X-Ingestion-Worker-Secret`

Checklist:

- `BACKEND_URL` points to the deployed API domain
- `INGESTION_WORKER_SHARED_SECRET` is configured in Cloud Run
- the deployed service can reach its own public URL

If this is broken, uploads or imports may create jobs that never process.

## Step 5: Enable Product Flags and Access

Email ingest is also gated by feature flags and plan tier.

Required feature flags:

- `feature_ingest_manual_upload`
- `feature_ingest_forwarded_mailbox`
- `feature_ingest_gmail_import`

Optional:

- `feature_ingest_admin_observability`

User requirements:

- the user must not be on the `free` tier
- `premium` and `pro` users can ingest
- Gmail lookback limits depend on tier

## Step 6: Configure Mailgun Forwarded Mailbox Ingest

The current webhook route is:

- `POST /api/ingestion/webhooks/mailgun`

Production endpoint example:

```text
https://your-domain.example/api/ingestion/webhooks/mailgun
```

Setup steps:

1. Configure inbound Mailgun routing for the mailbox domain you use.
2. Point Mailgun webhooks or routes to the API endpoint above.
3. Put the Mailgun signing key into `MAILGUN_WEBHOOK_SIGNING_KEY`.
4. Forward travel confirmations to the current forwarding address shown by the app.

Current default forwarding address in code:

- `travel.docs@duerk.org`

If you set `INGESTION_FORWARDING_ADDRESS`, that value overrides the built-in default shown above.

Important behavior:

- the Mailgun flow validates timestamp, signature, and replay token
- it matches the sender email to an existing app user
- unsupported attachments are skipped
- at least one supported body part or attachment must exist

## Step 7: Configure Gmail Import

Gmail import uses read-only OAuth and the callback route:

- `/api/ingestion/gmail/callback`

### Google Cloud Console setup

Create or update a Web OAuth client and add the redirect URI:

```text
https://your-domain.example/api/ingestion/gmail/callback
```

If you explicitly set `GOOGLE_GMAIL_CALLBACK_URL`, that exact URL must be registered in Google Cloud.

### Required secret env vars

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Gmail app flow

1. Sign in to the app as a `premium` or `pro` user.
2. Open the Ingestion screen.
3. Click `Connect Gmail`.
4. Complete Google consent.
5. Return to the app and confirm Gmail shows as connected.
6. Run `Dry Run` first.
7. Then run `Import`.

Important behavior:

- scope is Gmail read-only only
- search is limited to `INBOX`
- messages are filtered by the tier lookback window
- access tokens are refreshed automatically when possible
- if refresh fails, the provider connection is marked `AUTH_EXPIRED`

## Step 8: Keep Token Encryption Stable

Gmail provider tokens are encrypted at rest using:

- `INGESTION_ENCRYPTION_SECRET`

Do not rotate this casually between deploys unless you are prepared to reconnect Gmail accounts afterward.

If this secret changes, previously stored Gmail tokens will no longer decrypt correctly.

## Step 9: Smoke Test After Deploy

Run this checklist after a production deploy:

1. Open the app and confirm the ingestion tab loads.
2. Confirm `/api/ingestion/config` shows the expected features enabled.
3. If testing Mailgun:
   - forward a real travel confirmation from a known user email
   - verify a review item appears
4. If testing Gmail:
   - connect Gmail
   - run dry run
   - run import
   - verify review items appear
5. Assign one parsed item to a trip and confirm downstream trip records are created.

## Troubleshooting

### Jobs are created but never finish

Check:

- `BACKEND_URL`
- `INGESTION_WORKER_BASE_URL`
- `INGESTION_WORKER_SHARED_SECRET`
- Cloud Run logs for `/api/internal/ingestion/jobs/:jobId/run`

### Gmail connect succeeds but import fails later

Check:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- registered redirect URI
- whether the provider connection was marked `AUTH_EXPIRED`
- whether `INGESTION_ENCRYPTION_SECRET` changed since the Gmail connection was created

### Mailgun webhook returns 406

Common causes:

- sender email does not map to an existing user
- invalid or expired Mailgun signature
- replayed webhook token
- user is on the `free` tier
- no supported body part or attachment was present

### Ingestion UI says disabled

Check:

- feature flags
- user tier
- successful `/api/ingestion/config` response

## Deploy Script Checklist

For the current `deploy-api.ps1` flow, this is the practical env checklist.

### Put these in `server/.env`

- `BACKEND_URL`
- `GCLOUD_PROJECT_ID`
- `GOOGLE_CLOUD_PROJECT`
- `FIRESTORE_DATABASE_ID`
- `DB_PROVIDER`
- `USE_IN_MEMORY_DB`
- `GOOGLE_GMAIL_CALLBACK_URL` if you want an explicit callback override
- `INGESTION_WORKER_BASE_URL` if it should differ from `BACKEND_URL`
- `INGESTION_FORWARDING_ADDRESS` if you want to override the default forwarding inbox address
- `INGESTION_JOB_QUEUE_MODE` if you want it explicit

### Put these in `server/.secrets`

- `INGESTION_WORKER_SHARED_SECRET`
- `INGESTION_ENCRYPTION_SECRET`
- `MAILGUN_WEBHOOK_SIGNING_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Do not rely on these for Cloud Run runtime auth

- `GOOGLE_APPLICATION_CREDENTIALS`

Cloud Run should use its runtime service account and ADC instead.
