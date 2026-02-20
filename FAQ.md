# Travel Itinerary App - Implementation FAQ

This FAQ documents the current behavior of the codebase as implemented in `app/` and `server/`.

## 1. What is this app, technically?

It is a monorepo with:

- `app/`: Expo + React Native Web client (`app/App.tsx`)
- `server/`: Express + TypeScript API (`server/src/app.ts`)
- Workspace scripts at repo root (`package.json`) to run app/server tests and Playwright

The app supports trip planning across flights, lodging, tours, itinerary notes/details, expenses, ledger/cost reporting, groups, and account/family management.

## 2. How does authentication work?

### Q: What auth methods are supported?

- Email/password register/login (`/api/auth/*` and `/api/web-auth/*`)
- OAuth Google login (`/api/auth/google` + callback)
- Token auth for API requests using `Authorization: Bearer <jwt>`

### Q: How long do auth tokens last?

- JWTs are signed for `7d` in `server/src/auth.ts`.

### Q: Is email verification required?

- Yes for email/password registration.
- Unverified users cannot log in.
- Expired confirmation token can delete the unverified user record (`410` path in auth routes).

### Q: Is there a password setup requirement after OAuth?

- Yes for some OAuth-created accounts.
- When password setup is required, most API calls are blocked with `403`.
- Allowed while blocked: `PATCH /api/account/password`, invite list, and invite accept/reject routes.

## 3. What API surface is currently implemented?

### Q: How many route handlers exist?

- 81 route handlers across `server/src/routes/*` (`GET/POST/PUT/PATCH/DELETE`).

### Q: What are the main API domains?

- Auth: `authRoutes`, `webAuthRoutes`
- Account and family/fellow-travelers: `accountRoutes`
- Groups and invites: `groupsRouter` in `accountRoutes`
- Trips (including wizard + covered-by rules): `tripRoutes`
- Flights, lodging, tours (CRUD + expense sync): `flightRoutes`, `lodgingRoutes`, `tourRoutes`
- Manual expenses: `expenseRoutes`
- Itinerary generation + itinerary records/details: `itineraryRoutes`, `itineraryDataRoutes`
- Trait profile and demographics: `traitRoutes`
- Place search/location options/batch lookup: `placeRoutes`

### Q: Are any endpoints intentionally not implemented?

- `GET /api/trips/followed` returns an empty array placeholder.
- `POST /api/trips/follow` returns `501`.
- `GET /api/trips/:id/follow-code` returns `501`.
- `GET /api/places/:placeId` currently returns `404` ("temporarily unavailable").

### Q: Are there important validation/authorization behaviors?

- Almost all feature endpoints require bearer auth.
- Trip/group membership checks gate writes for flights/lodging/tours/expenses.
- Passenger/payer/traveler IDs must be group members for several write paths.
- Covering rules reject cycles and conflict states in `PUT /api/trips/:id/covered-by`.
- Flight/lodging/tour create/update also sync source-linked expense records.

## 4. What external APIs/services are used?

### Q: Which external APIs does the backend call?

- OpenAI Chat Completions for itinerary generation (`server/src/routes/itineraryRoutes.ts`)
- Unsplash search for destination imagery (`server/src/image-service.ts`)
- Google Cloud Storage for image caching and signed URLs (`server/src/image-service.ts`)
- SMTP via Nodemailer for verification/invite/share emails (`server/src/mailer.ts`)

Note: Google Places integration in `server/src/googlePlaces.ts` is mostly stubbed/disabled currently.

### Q: Which external APIs does the client call directly?

- Frankfurter exchange rate API (`app/utils/exchangeRates.ts`)
- Google Static Maps URL generation utility (`app/utils/googleMaps.ts`)

### Q: Is Firebase App Check used?

- Yes.
- Web uses reCAPTCHA v3 via Firebase Web SDK.
- Native uses RN Firebase App Check (Play Integrity / App Attest with DeviceCheck fallback).

### Q: How do API usage limits work for external providers?

Limits are configured in `server/config/api-limits.yaml` (tracked in git).
You can override the config path with `API_LIMITS_CONFIG_PATH`.

Supported providers currently include:

- `OPENAI`
- `UNSPLASH`
- `SMTP`
- `AIRPORT_DATASET`

The YAML includes provider-level settings (`window`, `windowHours`, `overall`) and caller-level caps under `callers`.

Behavior:

- Limits reset by UTC time window:
  - default: daily
  - Unsplash default: hourly
  - for hourly windows, `windowHours` controls duration (for example `24`)
- Missing/empty/non-positive limits are treated as unlimited.
- Logs emit at `50%`, `75%`, `90%`, and `100%` for both:
  - provider overall usage
  - caller usage
- Calls are blocked at `100%` of a configured limit.
- When blocked, routes can return `429` for relevant call paths.

## 5. What is the test behavior and current coverage posture?

### Q: What test runners are used?

- Jest for unit/integration tests (`app` + `server`)
- Playwright for E2E (`app/e2e`)

### Q: How are tests run?

- Root: `npm test` (runs app + server Jest)
- App only: `npm run test:app`
- Server only: `npm run test:server`
- E2E: `npm run test:e2e`

### Q: What is currently covered by tests?

- App test files: 45 (`app/tests`)
- Server test files: 30 (`server/__tests__`)
- E2E test specs: 1 (`app/e2e/create-trip.test.ts`)

Covered areas include:

- Auth/account lifecycle, onboarding, email verification, family/fellow-travelers
- Group invites and member removal side effects
- Trips/wizard and location handling
- Flights/lodging/tours CRUD and expense synchronization
- Ledger/cost report math (including covered-by rollups)
- Overview and Home tab behavior
- Mailer, redirects, provider selection, image service, place service

### Q: Is code coverage percentage enforced?

- No explicit coverage collection or thresholds are configured in Jest configs/scripts.
- There are targeted "covered" tests (for covered-by rollup scenarios), but no global minimum percentage gate.

### Q: Are there known test gaps?

- One skipped-by-filename test file exists: `server/__tests__/firestore-group-members.test.ts.skip`.
- Playwright currently has one primary create-trip happy-path flow.
- Some server features are intentionally placeholders (trip follow, place details endpoint), so behavior is limited by design.

## 6. How is user administration handled?

### Q: What user profile admin actions are available in-product?

Via `/api/account`:

- View profile (`GET /api/account`)
- Update name/email (`PATCH /api/account/profile`)
- Change/set password (`PATCH /api/account/password`)
- Delete account (`DELETE /api/account`)

### Q: What relationship management exists?

- Fellow travelers CRUD (`/api/account/fellow-travelers`)
- Family relationships create/accept/reject/update/delete (`/api/account/family*`)

### Q: What group and membership administration exists?

- Group list/create/delete
- Add/remove group members (users or guests)
- Invite list/accept/reject/cancel flows
- Trip-level member add/remove endpoints under `/api/account/trips/:tripId/members`

### Q: What happens when deleting an account?

- Account deletion triggers cleanup of related records.
- In in-memory mode there is an explicit transactional cleanup/reassignment path in `server/src/routes/accountRoutes.ts`.
- Non-memory mode delegates to `deleteWebUserAndCleanup` via DB adapter.

### Q: Are there operational user-admin scripts?

- `npm run list-users`
- `npm run list-trips`
- `npm run accounts:seed` (guarded for local use; requires `ALLOW_TEST_ACCOUNT_SEED=1`)

## 7. What is the current look and feel?

### Q: What is the UI style direction in the current code?

- Single-app shell with page-style tabs (`home`, `overview`, `flights`, `lodging`, `tours`, `expenses`, `ledger`, `trips`, etc.)
- Light visual theme with neutral grays/whites and blue primary actions
- Card/table-heavy layout with rounded corners and compact controls
- Home screen uses hero imagery and icon-labeled navigation rows

### Q: Is it cross-platform?

- Yes: web + native (Expo/React Native).
- Web-specific controls use HTML `select` in some flows.
- Native uses DateTimePicker where available, with text-input fallback.

### Q: How is responsiveness handled?

- Extensive use of flexible row/wrap layouts and scroll containers.
- Desktop-style tables in several sections with horizontal scrolling support.

## 8. What data/backend providers are supported?

### Q: Which DB providers can be selected?

- `postgres`, `memory`, `firebase`, `dynamodb` (dynamodb is scaffolded and not implemented).

### Q: Which provider is default?

- Defaults to `postgres` locally.
- Defaults to `firebase` in likely Cloud Run environments.
- `USE_IN_MEMORY_DB=1` forces memory adapter.

## 9. What are notable implementation constraints?

- CORS is strict: localhost patterns in local mode, otherwise `WEB_URL`.
- If no web build exists in `server/public/index.html`, `/` falls back to login page.
- Route aliases are kept for compatibility: `/api/auth/*` and `/api/web-auth/*` both serve web-auth endpoints.
