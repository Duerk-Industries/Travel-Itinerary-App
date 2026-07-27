# WanderBunnies — AGENTS.md

## Project Overview

A collaborative travel planning app ("Shared Trip Planner") that lets groups plan trips together, track expenses, manage lodgings/transfers/activities, and generate AI-powered itineraries.

**Monorepo with two packages:**
- `app/` — React Native / Expo frontend (runs on web and mobile)
- `server/` — Node.js / Express backend (TypeScript)

---

## Architecture

### Frontend (`app/`)

- **Framework:** React Native 0.81 + Expo 54, React 19, TypeScript
- **Web support:** `react-native-web` — the same codebase runs in browser via `expo start --web`
- **Entry point:** `App.tsx` (root) re-exports `app/App.tsx`
- **`app/App.tsx`** is the monolithic root component. It owns:
  - Global auth state and session bootstrap
  - Trip selection and page routing (tab-based, no navigation library)
  - Top-level data fetching and prop drilling into tabs
- **`app/tabs/`** — one file per feature area. Each tab file bundles its UI component(s) and its own API fetch helpers together:
  - `transfers.tsx`, `activities.tsx`, `lodging.tsx` / `LodgingTab.tsx`, `carRentals.tsx`, `itineraries.tsx`, `overview.tsx`, `dailyExpenses.tsx`, `ledger.tsx`, `tripDetails.tsx`, `account.tsx`, `traits.tsx`, `follow.tsx`, `following.tsx`, `createTripWizard.tsx`, `HomeTab.tsx`
- **`app/components/`** — shared UI components: `LodgingDetailsDialog`, `LodgingForm`, `ConfirmDialog`, `CostReportTable`, `TransferEditingForm`
- **`app/utils/`** — pure logic helpers (no UI):
  - `costs.ts` / `coveredBy.ts` — expense splitting and coverage rollup (run client-side)
  - `session.ts` — JWT stored in `localStorage` with configurable TTL (default 720 min)
  - `itineraryParser.ts`, `itineraryGeneration.ts` — parse/generate itinerary data
  - `formatDateLong.ts`, `normalizeDateString.ts`, `tripDates.ts` — date utilities
  - `mapLinks.ts` — builds deep-links for Google Maps / Apple Maps / Waze
  - `exchangeRates.ts` — currency conversion
  - `csv.ts` — cost report CSV export
  - `wizardGuard.ts` — page-change validation during trip creation wizard

**Auth (frontend):**
- Web: JWT token obtained from server, stored in `localStorage` via `session.ts`
- Native: Firebase Auth via `@react-native-firebase/auth` + App Check (`firebaseAppCheck.ts`)
- All API calls include `Authorization: Bearer <token>` header

### Backend (`server/`)

- **Framework:** Express 4, TypeScript, compiled to `dist/` via `tsc`
- **Entry:** `server/src/index.ts` — starts HTTP server on port 4000 (default), calls `initDb()`, seeds airport data and attractions catalog
- **App setup:** `server/src/app.ts` — registers middleware (CORS, JSON, access logging), mounts all route groups, serves the compiled Expo web build from `server/public/` as a SPA

**Route groups** (all under `/api/`):

| Prefix | File | Purpose |
|---|---|---|
| `/api/auth` | `authRoutes`, `webAuthRoutes` | Login, register, email verify, password |
| `/api/trips` | `tripRoutes` | CRUD for trips, group membership |
| `/api/itinerary` | `itineraryRoutes` | AI itinerary generation (async jobs) |
| `/api/itineraries` | `itineraryDataRoutes` | Itinerary records and day-level details |
| `/api/transfers` (+ `/api/flights`) | `transferRoutes` | Flights, trains, and other transfers |
| `/api/lodgings` | `lodgingRoutes` | Hotel / accommodation records |
| `/api/activities` | `activityRoutes` | Tours, sights, events |
| `/api/car-rentals` | `carRentalRoutes` | Car rental records |
| `/api/expenses` | `expenseRoutes` | Expense tracking |
| `/api/traits` | `traitRoutes` | User travel preferences |
| `/api/places` | `placeRoutes` | Google Places search + cached lookup |
| `/api/account` + `/api/groups` | `accountRoutes` | User profile, groups, family relationships |

**Database layer — pluggable adapter pattern:**
- `db.ts` — thin facade; every DB function delegates to the active adapter
- `db.providers.ts` — selects adapter at startup:
  - `postgres` — default locally (requires `DATABASE_URL`)
  - `firebase` — default on Google Cloud Run / GCP (auto-detected via `K_SERVICE`)
  - `memory` — `pg-mem` in-memory; used in tests (`USE_IN_MEMORY_DB=1`)
  - `dynamodb` — stub only, not implemented
  - Override with `DB_PROVIDER=postgres|firebase|memory`
- `db.postgres.ts`, `db.firebase.ts`, `db.memory.ts` — concrete implementations; all must satisfy the `DatabaseAdapter` interface (typed against `db.postgres.ts`)

**Auth (backend):**
- JWT signed with `AUTH_SECRET`; issued on login/OAuth callback
- Google OAuth via Passport.js (`passport-google-oauth20`)
- `server/src/auth.ts` — token creation/verification, Passport strategy setup
- CORS: localhost in local env, `WEB_URL` env var in production

**External API integrations** (`server/src/apis/`):
- `openaiApi.ts` / `openaiCallers.ts` — itinerary generation (OpenAI)
- `unsplashApi.ts` / `unsplashCallers.ts` — destination photography
- `smtpApi.ts` / `smtpCallers.ts` — transactional email (nodemailer)
- `airportDatasetApi.ts` — airport autocomplete data
- `server/src/googlePlaces.ts` — Google Places API

**Services** (`server/src/services/`):
- `itineraryAsyncService.ts` — in-process async job queue for AI itinerary generation
- `itineraryPromptPlanService.ts` — OpenAI prompt orchestration
- `attractionsCatalogService.ts` — curated attractions CSV → DB sync on startup
- `placeService.ts` — Google Places with DB-level caching
- `activityFeed.ts` — trip activity/event log
- `itemVoteService.ts` — thumbs-up/down votes on trip items

**Canonical types:** `server/src/types.ts` defines all shared data models (`User`, `Trip`, `Flight`, `Lodging`, `Activity`, `CarRental`, `Itinerary`, `Expense`, etc.).

---

## Development Workflow

### Running the frontend

```bash
cd app
npm install
npm run web          # Expo web dev server (hot reload)
```

### Running the backend

```bash
cd server
npm install
npm run dev          # tsx watch — restarts on file changes
```

Server runs on `http://localhost:4000` by default.

### Environment setup (server)

Create `server/.env` as the primary local source for both regular env vars and secrets (or use `server/.local_env` for local-only overrides) with:

```
DB_PROVIDER=postgres          # or firebase / memory
DATABASE_URL=postgresql://... # required for postgres
AUTH_SECRET=<random string>   # JWT signing secret
GOOGLE_CLIENT_ID=...          # optional: Google OAuth
GOOGLE_CLIENT_SECRET=...
OPENAI_API_KEY=...            # optional: AI itinerary generation
UNSPLASH_ACCESS_KEY=...       # optional: destination photos
WEB_URL=http://localhost:19006
```

To activate local overrides, create `server/.local_env` with `RUN_LOCAL=1` at the top. This file is checked by `isLocalEnv()` to enable localhost CORS and other dev-only behavior. `server/.secrets` is still supported as a backwards-compatible fallback, but `server/.env` is the primary local source.

Secret values can also be provided as file paths using the `_FILE` suffix convention (e.g., `AUTH_SECRET_FILE=/run/secrets/auth_secret`).

### Building for production

```bash
# Build frontend
cd app && npm run export:web   # outputs to app/dist/

# Build backend
cd server && npm run build     # compiles to server/dist/
cd server && npm start         # runs compiled server
```

The server serves the compiled frontend SPA from `server/public/`. Copy `app/dist/` contents there before deploying.

---

## Testing

### Frontend tests (Jest)

```bash
cd app
npm test
```

- Test files live in `app/tests/` and match `*.test.ts` / `*.test.tsx`
- Uses `ts-jest`, `jest-environment-jsdom`, `@testing-library/react-native`
- Mocks for RN modules in `app/tests/__mocks__/`
- Setup file: `app/tests/setupTests.ts`

### Backend tests (Jest)

```bash
cd server
npm test
```

- Test files live in `server/__tests__/`
- Uses `ts-jest` + `supertest` for HTTP integration tests
- Uses `pg-mem` in-memory DB — no real database needed for tests
- Tests set `USE_IN_MEMORY_DB=1` automatically via test setup

### E2E tests (Playwright)

```bash
cd app
npx playwright test
```

- E2E tests live in `app/e2e/`
- Require a running dev server

---

## Coding Standards

### TypeScript

- Strict mode enabled in both `app/tsconfig.json` and `server/tsconfig.json`
- All new code should be TypeScript; avoid `any` except where unavoidable at integration boundaries
- Use types from `server/src/types.ts` for all shared data models — do not redefine them locally
- Zod is available on the server for runtime validation of external input

### Adding a new API endpoint

1. Add the route handler to the appropriate file in `server/src/routes/`, or create a new route file
2. Mount it in `server/src/app.ts` under the correct `/api/` prefix
3. Add corresponding DB methods to `db.ts` (the facade), and implement them in both `db.postgres.ts` and `db.firebase.ts`
4. Add a fetch helper in the relevant `app/tabs/` file

### Adding a new tab / feature

1. Create `app/tabs/myFeature.tsx` with the component and its API fetch helpers
2. Import and render it from `app/App.tsx` behind the appropriate page condition
3. Add the tab label/button to the tab bar in `App.tsx`

### Database changes

- Postgres schema changes require a migration (add SQL migration files alongside `db.postgres.ts`)
- All new DB operations must be implemented in both `db.postgres.ts` and `db.firebase.ts` to keep adapters in sync
- The `DatabaseAdapter` type is inferred from `db.postgres.ts` — it is the source of truth for the interface

### Environment variables

- Read env vars on the server only through `getEnvValue()` / `getEnvFlag()` from `server/src/env.ts`
- These helpers support the `_FILE` suffix for Docker secrets
- Never access `process.env` directly in route or service code

### Logging

- Use `logInfo` / `logError` from `server/src/logger.ts` — do not use `console.log` in server code
- HTTP access is logged automatically by the middleware in `app.ts`

### Cost/expense logic

- All expense splitting and coverage rollup runs **client-side** in `app/utils/costs.ts` and `app/utils/coveredBy.ts`
- A mirror of `coveredBy.ts` exists in `server/src/utils/coveredBy.ts` for server-side validation — keep them in sync if changing the logic

### Platform differences

- Use `Platform.OS !== 'web'` guards for native-only modules (e.g., `NativeDateTimePicker`)
- Session storage uses `localStorage` on web; AsyncStorage is available but `session.ts` targets web
- `app/utils/webStyle.ts` provides `toWebStyle()` for web-only CSS properties

---

## Key Conventions

- **Naming:** files use camelCase for utilities (`formatDateLong.ts`), PascalCase for React components (`LodgingDetailsDialog.tsx`), camelCase for tab files (`tripDetails.tsx`)
- **Co-location:** each tab file owns its fetch logic — API calls are not centralized in a separate API layer
- **Backward compatibility:** `/api/flights` is a permanent alias for `/api/transfers`; do not remove it
- **Itinerary status lifecycle:** `Needed → Proposed → Booked → Completed | Cancelled` — enforced by `server/src/utils/itineraryStatus.ts` and mirrored in `app/utils/itineraryStatus.ts`
- **Voting:** trip items (flights, lodgings, activities) support thumbs-up/down votes via `itemVoteService.ts`; separate from star ratings

---

## Entitlement System

### Overview

The entitlement system enforces per-user tier limits and feature access. It lives in `server/src/services/entitlementService.ts`. See `docs/tiers.md`, `docs/admin.md`, and `docs/feature-flags.md` for full reference.

### Entitlement service contract

All entitlement checks throw `EntitlementError` (from `server/src/errors.ts`) on denial. Route handlers catch this and return HTTP 402 with `{ error, code }`.

Key functions:
- `assertCanUseFeature(userId, featureKey, role)` — checks feature flag (no admin bypass) then tier entitlement (admin bypasses)
- `assertUnderActiveTripLimit(userId, role)` — admin bypasses; throws `TIER_LIMIT_REACHED` at limit
- `assertUnderTravelerLimit(userId, groupId, role)` — admin bypasses
- `assertAndIncrementGenerationCount(userId, windowKey, role)` — atomic check+increment; admin tracked but not capped
- `getEffectiveLimit(userId, limitKey)` — rank-based tier inheritance; returns -1 for unlimited, null if no row

### Fail-open design

All checks are fail-open: a missing row in `feature_flags`, `tier_entitlements`, or `tier_limits` means **allowed**. This is intentional — it prevents schema gaps from locking users out in test or new-deployment scenarios.

### Bypass rules

- **Feature flags:** no bypass, even for admins.
- **Tier limits and entitlements:** admin bypasses all checks.
- **Past trip end dates:** admin bypasses validation in trip routes.

### Admin system

Admins have `role = 'admin'` in `users` table, carried in the JWT. Two bootstrap emails (`bryan.duerk@gmail.com`, `tristan.duerk@gmail.com`) are auto-granted admin on first login. All admin mutations write to `audit_log`. The admin UI lives in `app/tabs/AdminTab.tsx` and is only visible when `userRole === 'admin'`.

Admin cannot revoke their own admin role (self-demotion guard in `PATCH /api/admin/users/:id/role`).

### Feature flags

Flags are seeded from `server/config/feature-flags.yaml` at startup (missing rows only). The DB value always wins at runtime. Toggling via admin API or admin panel takes effect within 60 seconds (TTL cache).
