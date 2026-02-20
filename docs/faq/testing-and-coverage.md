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

Coverage includes auth/account lifecycle, invites and membership effects, trip wizard/location flows, flights/lodging/tours + expense sync, ledger/cost-report consistency, and core UI helpers/components.

## Is there a global coverage gate?

- No explicit `collectCoverage`/coverage threshold enforcement in current Jest configs/scripts.

## Known gaps?

- One skipped-by-filename test exists: `server/__tests__/firestore-group-members.test.ts.skip`.
- Playwright coverage is currently focused on one main create-trip happy path.
- Placeholder backend endpoints limit behavior that can be E2E validated.

