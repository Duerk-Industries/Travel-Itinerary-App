# Testing and Coverage FAQ

## What test runners are used?

- Jest for app and server tests
- Playwright for E2E

## How do you run tests?

- `npm test` (root, app + server Jest)
- `npm run test:app`
- `npm run test:server`
- `npm run test:e2e`

### E2E backend variants

| Command | Database | Prerequisite |
|---|---|---|
| `npm run test:e2e` | in-memory (pg-mem) | none |
| `DB_BACKEND=firebase npm run test:e2e` | Firestore emulator | `firebase emulators:start --only firestore` |
| `DB_BACKEND=postgres DATABASE_URL=... npm run test:e2e` | PostgreSQL | running Postgres instance |

Firebase is the recommended backend for realistic multi-user tests. The default (`memory`) is fastest and requires no external services.

## What is currently covered?

- App test files: 42 (`app/tests`)
- Server test files: 53 (`server/__tests__`)
- E2E test specs: 7 (`app/e2e/`)

Coverage includes auth/account lifecycle, invites and membership effects, trip wizard/location flows, transfers-lodging-activities + expense sync, ledger/cost-report consistency, core UI helpers/components, and the entitlement/tier/admin system.

Recent coverage additions include itinerary status behavior for transfers-lodging-activities-car rentals:
- Status defaulting for new vs legacy items.
- Status-based required-field relaxation (`Needed`/`Cancelled`) vs enforcement (`Proposed`/`Booked`/`Completed`).
- Transfer type support on transfer rows (`Flight`, `Train`, `Bus`, `Private`, `Ferry`, `Other`) with default `Flight`.
- Account profile optional fields (`homeAddress`, `preferredAirport`) on API + account form tests.

## E2E test suite index

| File | Focus area |
|---|---|
| `create-trip.test.ts` | Original happy-path wizard (single user) |
| `auth.test.ts` | Registration, login, session persistence, logout |
| `trip-creation-full.test.ts` | Wizard validation, back-navigation, participant invite |
| `trip-editing.test.ts` | Add/edit/delete for Transfers, Lodging, Activities, Car Rentals, Expenses |
| `multi-user-group.test.ts` | Two-context invite → accept/decline lifecycle |
| `performance.test.ts` | RAIL-model load and interaction budgets |
| `trip-management.test.ts` | Trip list, tab navigation, JS-error detection |

Full test case details are in [docs/e2e-test-plan.md](../e2e-test-plan.md).

## Performance thresholds (Google RAIL model)

| Journey | Budget | Rationale |
|---|---|---|
| Login → home screen interactive | 5 000 ms | RAIL "Load" / Web Vitals LCP ≤ 4s good |
| Trip selection → active trip visible | 3 000 ms | RAIL "Load" good threshold |
| Tab switch (data loaded) | 1 500 ms | RAIL "Response" extended for network round-trip |
| Wizard step advance (Next → heading) | 2 000 ms | UI feedback within two seconds |
| First Contentful Paint (FCP, Chromium) | 1 800 ms | Web Vitals "Good" FCP ≤ 1.8 s |

These are enforced as hard assertions in `performance.test.ts`. If a threshold is consistently exceeded, investigate the network payload, React render cost, or bundle size.

## testID naming convention

All interactive elements exposed to E2E tests follow the pattern `{entity}-{action}[-{id}]`:

| Pattern | Example | Where |
|---|---|---|
| `{entity}-add` | `transfer-add` | Add / open-create button |
| `{entity}-edit-{id}` | `lodging-edit-abc123` | Edit button on a specific row |
| `{entity}-delete-{id}` | `activity-delete-abc123` | Delete button on a specific row |
| `{entity}-row-{id}` | `transfer-row-abc123` | Table row container |
| `{entity}-save` | `activity-save` | Save button in a form modal |
| `{entity}-cancel` | `activity-cancel` | Cancel button in a form modal |
| `{entity}-form-modal` | `activity-form-modal` | Form modal container |
| `home-nav-{key}` | `home-nav-trips` | Home navigation buttons |
| `invite-modal` | — | Pending invite overlay |
| `invite-join-{id}` | `invite-join-xyz` | Accept invite button |
| `invite-decline-{id}` | `invite-decline-xyz` | Decline invite button |

## Test Plan Update: Flights -> Transfers

- File-level rename updates are reflected in test targets:
- App tests now use transfer filenames:
  - `app/tests/transfers.test.ts`
  - `app/tests/transfersDialog.test.tsx`
- Server tests now use transfer filenames:
  - `server/__tests__/transfers.test.ts`
  - `server/__tests__/overview-transfers.test.ts`
- Route file rename is reflected in tests and app wiring:
  - `server/src/routes/transferRoutes.ts`
- Targeted verification command set after rename:
  - `npm --prefix app test -- --runInBand tests/transfers.test.ts tests/transfersDialog.test.tsx tests/overview.test.tsx`
  - `npm --prefix server test -- --runInBand __tests__/transfers.test.ts __tests__/overview-transfers.test.ts __tests__/itemVotesRoutes.test.ts`

## Is there a global coverage gate?

- No explicit `collectCoverage`/coverage threshold enforcement in current Jest configs/scripts.

## Entitlement and admin test files

| File | Type | What it covers |
|---|---|---|
| `admin-bootstrap.test.ts` | Integration | Admin bootstrap grant, idempotency, case-insensitive match, JWT role |
| `admin-routes.test.ts` | Integration | All `/api/admin/*` endpoints: auth guards, CRUD, audit log |
| `tiers-limits.test.ts` | Integration | Trip/traveler limit enforcement (allow + block via `jest.spyOn`) |
| `itinerary-limits.test.ts` | Integration | AI generation limit, feature-disabled, entitlement-denied via `jest.spyOn` |
| `usage-tracking.test.ts` | Integration | `incrementUsageCounter`, `atomicIncrementIfUnderLimit`, window isolation |

### pg-mem note for entitlement tests

Seed data inserted in `initDb()` is not reliably visible to route handlers in pg-mem tests (likely a connection-pool isolation quirk). All entitlement checks are designed **fail-open** — a missing DB row means allowed, not denied. Tests that verify blocking behavior use `jest.spyOn` on `entitlementService` functions to inject `EntitlementError` without depending on seeded tier data.

## Known gaps?

- One skipped-by-filename test exists: `server/__tests__/firestore-group-members.test.ts.skip`.
- Multi-user E2E tests currently require a page reload to see changes from another user (no real-time push). See [docs/realtime-sync-recommendation.md](../realtime-sync-recommendation.md) for the upgrade path.
