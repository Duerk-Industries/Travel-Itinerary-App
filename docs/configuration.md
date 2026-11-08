# Configuration and local setup

[README](../README.md) · [Architecture](architecture.md) · [Manual administration](operations/manual-administration.md) · [Rollout testing](operations/rollout-testing.md)

Reviewed against source on 2026-11-08. Commands below run from the repository root.

## Local setup

Install Node 20+ and npm, then `npm ci`. Create `server/.env` with a minimal local configuration:

```dotenv
RUN_LOCAL=1
PORT=4000
DB_PROVIDER=memory
AUTH_SECRET=replace-with-a-long-random-local-secret
BACKEND_URL=http://localhost:4000
WEB_URL=http://localhost:8081
EXPO_PUBLIC_BACKEND_URL=http://localhost:4000
AUTH_REDIRECT_URI_ALLOWLIST=http://localhost:8081;travelitineraryplanner://
```

Memory storage is disposable and resets on process restart. For persistent local data, use `DB_PROVIDER=postgres` with a local `DATABASE_URL`, or Firebase with an explicitly selected emulator/project. `server/.env.example` is a catalog of settings, not a ready-to-run local file: it includes a hosted backend URL, emulator settings, HTTPS certificate paths and optional provider placeholders. Remove unused values rather than leaving sample keys active.

Start the API with `npm run dev` and the web client in another terminal with `npm --prefix app run web -- --port 8081`. Confirm `/api/healthz` on port 4000 and open the app on port 8081. `npm run dev` invokes an optional dev-account seed first; it only enables seeding when `ALLOW_TEST_ACCOUNT_SEED=1` and the runtime is local. See `scripts/seed-dev-accounts.ts` before opting in.

For native development use `npm --prefix app run android` or `npm --prefix app run ios` with the platform toolchain and required Firebase/native configuration. A physical device needs a reachable API hostname; its `localhost` is the device. See the [Expo deployment checklist](expo-deployment-checklist.md) for build/release steps.

## Environment loading and secrets

Use `server/.env` as the main local file. `server/.local_env` is an optional override file; include `RUN_LOCAL=1` in it. Root `.env`/`.local_env` and legacy `.secrets` files are also supported. Avoid conflicting values across these files.

There is **no single universal precedence order** across tools:

- Normal server startup imports `instrument.ts` first, which invokes `env_loader.ts` before Sentry and Express initialization. `server/src/app.ts` subsequently fills unset variables from marked local files, then server/root `.env` and legacy `.secrets` files.
- `server/src/env_loader.ts` is also used during initialization/tooling. In ordinary local runs it permits overrides, loading root then server `.env` and marked local files. Hosted and Jest/E2E runs do not use that override behavior.
- `app/scripts/start-web.js` loads app `.env`, then overrides from root `.env`, server `.env` and server `.local_env`. Its local-file loading is skipped for `E2E_MODE=1`. The frontend wrapper loads server `.local_env` without the server marker check.
- The export wrapper defaults the bundled API URL to `https://wander-bunnies.com` unless `EXPO_PUBLIC_BACKEND_URL` is explicitly supplied; set it for test exports.
- The E2E runner supplies isolated values and skips local dotenv loading. Tests have their own bootstrap; see [test configuration](../TEST_PLAN.md).

Server code reads settings with `getEnvValue()`/`getEnvFlag()` from `server/src/env.ts`. A readable, nonempty `KEY_FILE` takes precedence over `KEY`; trailing line breaks are trimmed. Boolean flags accept `1/true/yes/on` and `0/false/no/off`. `BACKEND_URL` precedes `WEB_URL` in `getBackendUrl()`, so verify CORS and generated callback URLs when separating web and API origins.

`EXPO_PUBLIC_*` values are client-visible build inputs. Never put credentials there. Changing a bundled frontend URL generally requires restarting Metro or exporting/releasing a new build; changing server configuration requires restarting/redeploying the server. Store production secrets through the deployment secret mechanism, not committed dotenv files. See [key management](security/key-management.md).

## Configuration ownership

| Setting | Where to change it | When it takes effect |
|---|---|---|
| Database/provider, origins, credentials, worker mode, buckets | Server environment / deployment secret configuration | Server restart or deployment |
| Client API URL and native build settings | Expo environment and `app/app.config.ts` | New bundle/build; restart development tooling |
| Feature defaults | `server/config/feature-flags.yaml` | Seeds missing database rows at startup |
| Live flags and cohorts | Admin → Feature Flags / database-backed controls | Cached; allow up to 60 seconds across instances |
| Tier limits and entitlements | Admin → Tiers | Database-backed; verify with the target tier/account |
| AI feature provider/model routing | Admin → AI Operations; env provides defaults/keys | Verify routing with an actual request and recorded attempt |
| API limits/pricing configuration | `server/config/api-limits.yaml` and supported admin controls | Depends on the consuming service; verify loaded config and usage |
| Release services, sites, database IDs, artifacts and isolation | `scripts/deploy.config` from `.example` | Consumed by release scripts; may invalidate an earlier config fingerprint |

YAML defaults do not overwrite established live flag rows. This rule is specific to feature flags: `seedEntitlementDefaults()` also upserts selected tier entitlement defaults at startup. Review that seed list before expecting a manual entitlement edit to survive a restart. `STARTUP_FORCE_ENABLE_FEATURE_FLAGS` is an explicit startup override; inspect it if a disabled flag returns after restart. The complete current flag inventory is in YAML and Admin, not the abbreviated [flag guide](feature-flags.md).

## Integration checklist

Only configure the capabilities being exercised. Use the example file and the consuming service for exact keys/defaults.

| Capability | Main settings / guide |
|---|---|
| Postgres | `DATABASE_URL`; [architecture](architecture.md) and migration tooling |
| Firebase | Explicit project/database and storage configuration, emulator host only for local use; [deployment](../DEPLOYMENT-GCP-FIREBASE.md), [ACL backfill](security/firestore-acl-backfill-runbook.md) |
| OAuth | Provider credentials plus `AUTH_REDIRECT_URI_ALLOWLIST`; native scheme `travelitineraryplanner://`; [auth docs](auth/README.md) |
| AI | Provider keys, `AI_ITINERARY_PROVIDER`/`MODEL`, ingestion routing defaults; Admin → AI Operations; `AI_CAPTURE_BUCKET` for durable hosted capture |
| Mail/import | SMTP credentials, intake/worker configuration, intake flags; [mailbox deployment](ingestion-mailbox-deployment.md), [ingestion rollout](ingestion-rollout.md) |
| Billing | Server credentials, signed webhooks, product/prices and enablement; [subscription checklist](stripe-premium-subscriptions-checklist.md) |
| Maps/discovery | Provider keys, provider credits and daily caps; [map operations](operations/gap-closing-maps.md) |
| Analytics/diagnostics | Consent, runtime switches and deployment gates; [analytics runbook](analytics-runbook.md), [Sentry](sentry.md) |
| Optional bank import | Separate flags, credentials, encryption and cleanup requirements; [Plaid plan](plaid-transaction-import-plan.md) and code in `packages/plaid-transactions/` |

## Diagnosing configuration failures

Check the API startup log for selected DB adapter, loaded environment files, storage bucket and configuration paths. Confirm the browser's actual API request origin. For missing participant/payer names, inspect the authenticated group-member request and current trip membership before changing activity data. For denied features, check the flag/cohort first, then entitlement/limit and any integration-specific enablement. Do not assume an admin account reproduces an ordinary user's tier restrictions.

Run `npm run build` for the backend and `npm --prefix app run export:web` for the client. Follow the [production guide](production-deployment-guide.md) for artifact pairing and promotion; a local build is not a deployment.
