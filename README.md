# Shared-Trip-Planner

A starter shared trip planner stack with a TypeScript/Node.js API backed by PostgreSQL and an Expo (React Native) client that runs on web, Android, and iOS. Transfers are tied to the authenticated user but can be shared with other accounts via email.

## What's inside
- **server**: Express API with JWT auth, PostgreSQL schema for transfers, and endpoints to add/remove/share transfers.
- **app**: Expo application with Apple/Google/email login flows and a simple UI to list and manage transfers across web, Android, and iOS.

## Getting started
1. Install dependencies (workspace aware):
   ```bash
   npm install
   ```
2. Configure the API:
   - Copy `server/.env.example` to `server/.env` and update `DATABASE_URL` for your PostgreSQL instance and `AUTH_SECRET` for JWT signing.
   - Choose a database provider with `DB_PROVIDER=postgres|memory|dynamodb|firebase` (defaults to `postgres`; `memory` reuses pg-mem for tests; DynamoDB/Firebase paths are scaffolded and will throw until fully implemented). `USE_IN_MEMORY_DB=1` still works for backwards compatibility in tests.
   - Ensure PostgreSQL is running and accessible.
3. Run the API (from repo root):
   ```bash
   cd server
   npm run dev
   ```
   The server will create the required tables on startup.
   - To enable sharing emails, set these in `server/.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and optionally `SMTP_USER`/`SMTP_PASS` if your SMTP server requires auth.
4. Configure the Expo app:
   - Set `BACKEND_URL` in your shell when running the client (defaults to `http://localhost:4000`).
   - Replace the placeholder Google client IDs in `app/App.tsx` and update bundle identifiers in `app/app.config.ts` for production.
   - Enable Apple sign-in in your Apple developer settings if targeting iOS hardware.
5. Start the client (from repo root):
   ```bash
   cd app
   npm run web # or npm run ios / npm run android
   ```

## API usage limits (external providers)

The server supports configurable usage limits for external API providers (OpenAI, Unsplash, SMTP, and airport dataset download).

### How to configure

Limits are configured in `server/config/api-limits.yaml` (tracked in git).

You can optionally override the file path with:

- `API_LIMITS_CONFIG_PATH`

YAML structure:

```yaml
providers:
  OPENAI:
    window: hour
    windowHours: 24
    overall: 1000
    callers:
      ITINERARY_GENERATE_PLAN: 50
      ITINERARY_PLAN_P0_NORM: 200
      ITINERARY_PLAN_P1_ROUTE: 200
      ITINERARY_PLAN_P2_DAYS: 200
      ITINERARY_PLAN_P3_VALIDATE: 200
      ITINERARY_PLAN_P4_RENDER: 200
caching:
  attractions:
    refreshDays: 365
    limitPerDestination: 20
    shortlistPromptItemsPerDestination: 8
    minDistinctSourcesPerAttraction: 2
    minAttractionsAfterConfidenceFilter: 6
    promptBlobRefreshDays: 30
  locations:
    csvCacheTtlMinutes: 60
    refreshCooldownSeconds: 15
  images:
    cacheTtlMs: 604800000
    signedUrlTtlMs: 3600000
  googlePlaces:
    detailsCacheTimeoutMinutes: 1440
  unsplash:
    dnsLogTtlMs: 300000
```

### Behavior

- Limits reset by provider time window (UTC-based):
  - Default is `day`.
  - Unsplash defaults to `hour`.
  - When `window: hour`, `windowHours` controls bucket size (for example `24`).
- If a limit is missing, empty, non-numeric, or non-positive, that scope is treated as unlimited.
- Logs are emitted at `50%`, `75%`, `90%`, and `100%` for:
  - provider overall usage
  - caller usage
- Calls are blocked at `100%` of a configured limit.
- Some routes may return `429` when a limit blocks a call (for example itinerary generation via OpenAI).

### Itinerary prompt pipeline

- `POST /api/itinerary` now runs a multi-step prompt pipeline using assets in `server/prompts/`:
  - normalize input (`p0_norm`)
  - route/bases/transfers (`p1_route`)
  - day expansion (`p2_days`)
  - validation/repair (`p3_validate`)
  - markdown rendering (`p4_render_md`)
- Response includes:
  - `plan` (markdown)
  - `details` (structured itinerary detail rows)
  - `generatedItems` (`transfers`, `lodgings`, `activities`, `carRentals`)
- Generated trip items are emitted in app-ready shape and should be inserted with `status: "Needed"`.

### Destination attraction catalog (web search + CSV + DB)

- The server now maintains a destination attraction catalog used by itinerary generation.
- For each destination, it discovers up to 20 ranked attractions from web-search sources:
  - `SERPAPI_API_KEY` provider (if configured)
  - Wikipedia search fallback (always available)
- Refresh behavior and shortlist sizing are controlled in `server/config/api-limits.yaml` under `caching.attractions.*`.
- Each attraction is stored with:
  - inferred `activityType`
  - inferred interest tags from:
    - `outdoors`, `culture`, `food`, `nightlife`, `relax`, `shopping`, `day trips`, `events`, `classes`
- Persistence:
  - Database: `locations` records with `source_type=attraction`
  - CSV:
    - local: `server/data/attractions_catalog.csv` (default)
    - GCP: `gs://<LOCATION_BUCKET>/<ATTRACTIONS_CSV_PATH>` (default path: `locations/attractions_catalog.csv`)
- Startup behavior:
  - server imports the attractions CSV into DB on boot
  - new destination discovery appends/merges into CSV and DB
- Prompt usage:
  - itinerary prompts now prioritize ranked shortlist items first, then generic-safe fallback when needed
  - source-confidence filter is applied before shortlist admission using distinct source groups
  - per-destination refresh lock prevents duplicate concurrent discovery calls
  - compact prompt-ready shortlist blobs are stored by destination/date and reused for generation
  - shortlist entries include budget tiers (`free`, `paid`, `premium`) and prompt assembly prioritizes tiers based on trip budget

## API quick reference
- `POST /api/auth/email { email }` → create/login a user via email, returning a JWT.
- `POST /api/auth/oauth { email, provider }` → Google or Apple login using the provider name and email claim.
- `GET /api/account` → fetch account profile (includes optional `homeAddress` and `preferredAirport`).
- `PATCH /api/account/profile` → update account profile fields (`firstName`, `lastName`, `email`, optional `homeAddress`, optional `preferredAirport`).
- `POST /api/itinerary` → generate itinerary markdown + structured details + structured generated trip items from the prompt-pack service.
- `GET /api/transfers` → list transfers for the authenticated user.
- `POST /api/transfers` → add a transfer with passenger, dates/times, layover, carrier/number, booking reference, and cost.
- `PATCH /api/transfers/:id` → update a transfer's details.
- `DELETE /api/transfers/:id` → remove a transfer owned by the user.
- `POST /api/transfers/:id/share { email }` → share a transfer with another account by email.
- `transferType` enum values: `Flight`, `Train`, `Bus`, `Private`, `Ferry`, `Other`.
- `POST /api/groups { name, members[] }` → create a group and invite users/guests (members use `email` for existing users or `guestName` for non-login members).
- `GET /api/groups/invites` → list pending group invites for the authenticated user.
- `POST /api/groups/invites/:id/accept` → accept a pending group invite.
- `GET /api/groups?sort=name|created` → list groups the user belongs to, with members.
- `POST /api/groups/:id/members { email | guestName }` → add a member (existing user via email -> invite; guest added directly).
- `DELETE /api/groups/:groupId/members/:memberId` → remove a member (owner only; owner cannot be removed).
- `DELETE /api/groups/invites/:id` → cancel a pending invite (group owner).
- `DELETE /api/groups/:id` → delete a group (owner only).
- `GET /api/groups/:id/members` → list group members (must be in group).
- `GET /api/trips` → list trips in groups the user belongs to.
- `POST /api/trips { name, groupId }` → create a trip under a group the user is in.
- `DELETE /api/trips/:id` → delete a trip (must belong to the group).
- `PATCH /api/trips/:id/group { groupId }` → move a trip to another group the user belongs to.

## Testing
- App unit/UI tests: `npm run test:app` (or `cd app && npm test`)
- Server tests: `npm run test:server`
- Playwright e2e tests: `npm run test:e2e`
- Run everything: `npm test` (from repo root)
- Day overview/day details interactions are covered in `app/tests/overview.test.tsx`.

## Proposed Item Voting

- Voting is available on Transfers, Lodging, Activities, and Car Rentals.
- The `Votes` and `Rating` columns appear immediately after `Status`.
- If an item is `Proposed` and you have not voted yet, you can vote `👍` or `👎`.
- If an item is not `Proposed`, or you already voted, the UI shows net votes.
- If an item is `Completed` and you have not rated it yet, you can rate `👍` or `👎`.
- If an item is `Completed` and already rated, the UI shows net rating.
- Ratings do not apply to non-`Completed` items.
- Only full trip members can vote. Followers can view items but cannot vote.

## FAQ and Specifications
- Full single-page implementation FAQ: [`FAQ.md`](FAQ.md)
- Split topic docs index: [`docs/faq/README.md`](docs/faq/README.md)
- [`docs/faq/overview.md`](docs/faq/overview.md)
- [`docs/faq/auth-and-access.md`](docs/faq/auth-and-access.md)
- [`docs/faq/api-usage.md`](docs/faq/api-usage.md)
- [`docs/faq/testing-and-coverage.md`](docs/faq/testing-and-coverage.md)
- [`docs/faq/user-administration.md`](docs/faq/user-administration.md)
- [`docs/faq/look-and-feel.md`](docs/faq/look-and-feel.md)
- [`docs/faq/operations-and-constraints.md`](docs/faq/operations-and-constraints.md)

## Notes
- This project is a base implementation; plug in real OAuth client IDs/secrets and production storage for secure deployments.
- The Expo client uses React Native Web so the same code runs on web, Android, and iOS.
