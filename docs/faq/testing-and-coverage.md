# Testing and Coverage FAQ

## What test runners are used?

- Jest for app and server tests
- Playwright for E2E

## How do you run tests?

- `npm test` (root, app + server Jest)
- `npm run test:app`
- `npm run test:server`
- `npm run test:e2e`

## What is currently covered?

- App test files: 45 (`app/tests`)
- Server test files: 30 (`server/__tests__`)
- E2E test specs: 1 (`app/e2e/create-trip.test.ts`)

Coverage includes auth/account lifecycle, invites and membership effects, trip wizard/location flows, transfers-lodging-activities + expense sync, ledger/cost-report consistency, and core UI helpers/components.

Recent coverage additions include itinerary status behavior for transfers-lodging-activities-car rentals:
- Status defaulting for new vs legacy items.
- Status-based required-field relaxation (`Needed`/`Cancelled`) vs enforcement (`Proposed`/`Booked`/`Completed`).
- Transfer type support on transfer rows (`Flight`, `Train`, `Bus`, `Private`, `Ferry`, `Other`) with default `Flight`.
- Account profile optional fields (`homeAddress`, `preferredAirport`) on API + account form tests.

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

## Known gaps?

- One skipped-by-filename test exists: `server/__tests__/firestore-group-members.test.ts.skip`.
- Playwright coverage is currently focused on one main create-trip happy path.
- Placeholder backend endpoints limit behavior that can be E2E validated.

