# Test guide

[README](README.md) · [Documentation hub](docs/README.md) · [Manual rollout checklist](docs/operations/rollout-testing.md) · [E2E journeys](docs/e2e-test-plan.md)

Reviewed against scripts and runner configuration on 2026-11-08. Run commands from the repository root after `npm ci`. This guide documents how to validate a change; it does not claim that every listed check has passed for a particular release.

## Automated checks

| Check | Command | Scope |
|---|---|---|
| Root type-check command | `npm run typecheck` | App, server, messaging, domain and analytics |
| App + server Jest | `npm test` | Runs the sharded app and server suites; excludes Playwright/native device tests |
| App Jest | `npm run test:app` | Four shards through the shared shard runner |
| Server Jest | `npm run test:server` | Twelve shards through the shared shard runner |
| Focused app regression | `npm --prefix app test -- --runInBand useTripsData.test.tsx activityEditForm.test.tsx payerSelection.test.tsx` | Member loading, activity form and payer controls |
| Focused server regression | `npm --prefix server run test:single -- --runInBand __tests__/group-member-removal.test.ts` | Example targeted integration suite |
| Backend production build | `npm run build` | TypeScript and runtime asset copy |
| Web production export | `npm --prefix app run export:web` | Expo web bundle; separate from backend build |
| Browser journeys | `npm run playwright:install` then `npm run test:e2e` | Chromium against isolated API and Expo servers |
| Keyboard/selector browser regressions | `npx playwright test --config playwright.mobile-input.config.ts` | Mocked API at phone/desktop widths; separate config |
| Native launch smoke | `npm run e2e:maestro` | Requires Maestro and a running emulator/device with the app installed |
| All Maestro flows | `npm run e2e:maestro:all` | Device flows under `.maestro/` |

Use `npm run test:app:all -- --runInBand` or `npm run test:server:all -- --runInBand` for a non-sharded full Jest run. `lint` currently invokes package type checks; it is not a separate comprehensive style/security scan. Inspect [CI](.github/workflows/ci.yml) for the checks run on pull requests. Separate push-triggered production deploy workflows do not wait for CI.

## Database variants

Server Jest uses `server/jest.projects.js` and `server/__tests__/jest-setup.ts`. Despite the project display name `firebase`, the bootstrap defaults to **memory/pg-mem** through `JEST_DB_PROVIDER`. Setting only ordinary `DB_PROVIDER` does not select an alternate Jest backend.

For Firestore, start local emulators first (Firestore for adapter tests; Firestore **and Auth** for rule tests) and use:

```sh
npm --prefix server run test:firestore -- __tests__/group-member-removal.test.ts
npm --prefix server run test:firestore-rules
```

The wrapper defaults to emulator `127.0.0.1:8080` and throwaway project `demo-server-tests`; `TEST_FIRESTORE_PROJECT` overrides the project. Firestore-rule tests have their own wrapper. Suites that seed raw SQL need Postgres/memory and cannot simply be assumed to run on Firestore.

For Postgres Jest, set `JEST_DB_PROVIDER=postgres` and a **disposable** `DATABASE_URL` in the test process. Test setup/cleanup writes data. Never use a production database. Memory tests do not cover hosted Firestore indexes, rules, credentials, storage or actual external-provider delivery. Use emulator and isolated deployed checks for changes to those paths.

## Browser test environment

[`playwright.config.ts`](playwright.config.ts) starts its own API on **4011** and Expo frontend on **4173**; do not start regular development servers first. Defaults are two local workers and memory storage. `E2E_MODE=1` skips local dotenv credentials, and mail/provider-delivery notification work is disabled. Test helpers/stubs do not validate live mail, payments or AI providers.

| Variable | Meaning |
|---|---|
| `DB_BACKEND` | `memory` (default), `firebase` (running emulator), or `postgres` (disposable database) |
| `E2E_API_PORT`, `E2E_WEB_PORT` | Change isolated server ports |
| `E2E_REUSE_SERVERS=1` | Explicit local reuse only; servers must already have the correct E2E settings |
| `E2E_AUTH_SECRET` | Override isolated signing secret |

Example PowerShell:

```powershell
$env:DB_BACKEND = 'memory'
npm run test:e2e -- --workers=1
```

Failures retain screenshots/traces in `test-results/`. Use `npx playwright show-report` or `npx playwright show-trace <trace.zip>`. See the [E2E plan](docs/e2e-test-plan.md) for journeys and the dedicated mobile-input config. Browser emulation does not replace physical iOS/Android keyboard, deep-link, notification or storage checks.

## What to validate by change

| Change | Required evidence to select |
|---|---|
| Membership/selectors | Roster load/failure/trip-switch regression, active/pending/removed members, activity participants + one payer, save/reopen on overview and Activities |
| Expenses | Splits, coverage, currency totals and rounding; mirrored coverage validation; CSV/report and payer behavior |
| Authorization/tiers/flags | Ordinary user vs admin; excluded cohort; denial response; no writes on denial; audit log; wait through cache TTL |
| Schema/adapter | Targeted API tests, both adapters, migration/index/backfill in isolated target environment |
| AI/imports | Quotas, retry/idempotency/duplicate behavior, invalid inputs, recorded provider/model, review/assign; one controlled provider check where applicable |
| Billing/privacy | Signed webhook/cleanup behavior and entitlement reconciliation; use subsystem runbooks |
| Web/native UI | Phone/desktop layout and keyboard/modal behavior; physical devices for native changes |
| Deployment tooling | `npm --prefix server run test:single -- --runInBand __tests__/deploy __tests__/middleware/canarySafeMode.test.ts`; dry runs and paired artifact/evidence validation |

## Manual rollout testing

Follow the [rollout testing checklist](docs/operations/rollout-testing.md) for prerequisites, ordered actions, expected results, release evidence and rollback decisions. It includes ordinary-user checks, admin changes, participant/payer persistence, multi-user synchronization and native compatibility.

Feature flags are cached for up to 60 seconds; do not use an immediate click as the sole disablement assertion. The general entitlement service checks flags before tier entitlements; integration routes may use additional checks or response codes. Avoid hard-coding mutable tier limits in release expectations: inspect Admin → Tiers and record the tested values.

A successful `/api/healthz` or `scripts/smoke-test.*` only establishes HTTP liveness. It does not establish database readiness outside E2E, successful login, persisted writes or usable external integrations. A release needs recorded functional results as well as script evidence.
