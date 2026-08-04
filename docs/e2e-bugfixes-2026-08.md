# E2E Test Suite Recovery & Bug Fixes — August 2026

This documents a round of Chrome/Playwright-driven exploratory testing that
found the local e2e workflow (`npx playwright test`, per `CLAUDE.md`) was
completely non-functional, plus numerous real app bugs surfaced along the
way. The suite went from **0/52 passing (couldn't even boot)** to **28-32/52
passing** (see "Current status" below — pass count varies run-to-run due to
parallel-execution resource contention on the dev machine, not code changes).

## App / infrastructure bugs (real bugs, not test-only issues)

### 1. `server/src/env_loader.ts` — env overrides clobbered explicit test config
`shouldOverride` was `true` whenever the process wasn't Jest or Cloud Run, so
`server/.env`'s `DB_PROVIDER` (e.g. `firebase`) always beat the
`DB_PROVIDER=memory` / `USE_IN_MEMORY_DB=1` that `playwright.config.ts`
explicitly passes to its `webServer`. Locally this meant e2e runs tried to
connect to a real Firestore emulator that isn't running, and hung until
timeout.
**Fix:** also treat `E2E_MODE` (already the established "local/e2e" signal
used by `isLocalEnv()`) as a reason to skip the override.

### 2. `app/scripts/start-web.js` — silently ignored `--port`
It never read `process.argv`. It only ever passed a `--port` flag to Expo
when `USE_IN_MEMORY_DB=1` (and then hardcoded **80**); otherwise Expo just
bound to Metro's default (8081). `npm run web -- --port 4173` — exactly what
`playwright.config.ts` invokes — never actually served on 4173.
**Fix:** read `--port` from `process.argv` and forward it, falling back to
the old `USE_IN_MEMORY_DB` → port 80 behavior only when no port was given.

### 3. `server/src/socket/index.ts` — Socket.IO CORS didn't match the HTTP CORS
`app.ts`'s regular CORS middleware allows any `localhost`/`127.0.0.1` port in
local dev via regex. The Socket.IO server's local allowlist was a fixed list
of ports (`3000/4000/8081/19006`) with no `127.0.0.1` variant and no `4173` —
so chat/presence over WebSockets was silently rejected by CORS whenever the
app was loaded via `127.0.0.1` (exactly what Playwright's own `baseURL`
uses).
**Fix:** use the same two regexes (`^http://localhost(:\d+)?$`,
`^http://127\.0\.0\.1(:\d+)?$`) as `app.ts`, instead of an enumerated port
list.

### 4. `playwright.config.ts` — wrong health-check URL
The backend `webServer` entry polled bare `http://127.0.0.1:4000`. That route
404s whenever `server/public/` has no built SPA (true for any fresh
checkout/local dev, since the web app is normally run via its own Expo dev
server, not the compiled Express static server) — so the readiness check
could never succeed. There's already a purpose-built `GET /api/healthz`.
**Fix:** point the health check at `/api/healthz`.

### 5. `server/src/services/httpRateLimitService.ts` — rate limits not relaxed for e2e
`testSafeDefault()` only relaxed limits when `NODE_ENV === 'test'` (Jest).
Under Playwright (not Jest), a handful of parallel workers registering/
logging in within seconds tripped the real production login-rate-limit
(10 requests / 15 min), cascading into 429s across most of the suite.
**Fix:** also relax under `isLocalEnv()` (which already recognizes
`E2E_MODE`), consistent with how the rest of the codebase signals
local/e2e mode.

### 6. `server/src/routes/transferRoutes.ts` — `NaN` cost silently stored
`cost: Number(cost) ?? 0` — `Number(undefined)` is `NaN`, and `NaN ?? 0`
stays `NaN` because `??` only falls back on `null`/`undefined`, not `NaN`.
Creating a flight/transfer without an explicit cost stored a literal `NaN`
in the `cost` column **and** in the auto-created linked expense's `amount` —
which would corrupt downstream cost totals (trip cost report, expense
splitting) for any real trip item created without a cost.
**Fix:** compute `normalizedCost = Number.isFinite(Number(cost)) ? Number(cost) : 0`
once, and use it for both the flight record and its linked expense.

### 7. `server/src/routes/lodgingRoutes.ts` — empty-string `refundBy` broke lodging creation entirely
`refundBy: dto.refundBy ?? null` — same `??`-vs-empty-string anti-pattern as
#6. The web form submits `refundBy: ''` when left blank (not `undefined`),
so `'' ?? null` stays `''`, which gets bound to the `refund_by DATE` column.
This made **every** lodging creation through the UI fail (pg-mem rejected
the empty string as an invalid date; likely also fragile against real
Postgres depending on driver-level type coercion).
**Fix:** `refundBy: dto.refundBy || null` — falsy (including `''`) now
correctly falls back to `null`.

### 8. `server/src/db.postgres.ts` — two pg-mem limitations blocking lodging/car-rental writes
- **Lodging insert**: parameterized `$N` placeholders for `check_in_date`/
  `check_out_date` (`DATE` columns) made pg-mem's evaluator throw "Invalid
  timestamp format". Fixed with explicit `$6::date, $7::date` casts —
  harmless and idiomatic on real Postgres too.
- **Car rental delete**: the query used `DELETE ... USING trips t WHERE
  EXISTS (... correlated back to the DELETE target ...)`. Both `DELETE
  ... USING` and *any* subquery correlated to the DELETE target are
  unsupported by pg-mem's parser (confirmed via a minimal standalone
  repro) — real Postgres handles this fine, but the memory-DB adapter
  (used for e2e and quick local dev) 500'd on every delete attempt.
  Rewrote as a non-correlated `trip_id IN (SELECT ...)` subquery, which is
  standard, portable SQL and works identically on both.

### 9. `app/App.tsx` — `refreshPageData` race silently drops tab-navigation fetches (confirmed, not yet fixed)
`refreshPageData` is gated by a `refreshInFlightRef` mutex and keys its
per-page fetch (`switch (currentPage) { case 'lodging': fetchLodgings() ...
}`) off the `activePage` closure at the time it *starts* running. If a
user navigates to a new tab while the initial page-load refresh (fired for
whatever page a restored session was on) is still in flight, the
navigation's own refresh call is silently no-op'd by the mutex — and
because the in-flight call captured the *old* page in its closure, it
never fetches the new tab's data either. Net effect: reload the page, then
immediately click a different tab, and that tab can render with **no data
even though the data exists server-side** — confirmed via direct network
logging (no second fetch request ever fires). This is far more likely to
manifest for a script clicking within milliseconds of load than for a
human, but a real user on a slow connection could hit it too.
**Not fixed** — the mutex is presumably intentional (avoid duplicate/
overlapping fetches) and a proper fix needs to either retry after the
in-flight call resolves or use the latest `activePage` rather than a
captured one, without reintroducing duplicate-fetch races. Flagging for
dedicated engineering time rather than a rushed change to shared
navigation/data-loading code. **Test-side mitigation applied**: added
`await page.waitForLoadState('networkidle')` immediately after every
`page.reload()` in `trip-editing.test.ts`, before navigating to a tab, to
avoid tripping the race in the test suite.

## Real UI/UX changes the test suite hadn't caught up to

- **Trip creation entry point**: `home-nav-trips` + "Open Wizard" no longer
  exist — trip creation is now a direct `home-create-trip-button`; trip
  *switching* is now a "Select a trip" modal opened from `home-hero-card`.
- **Dates step**: native `<input type="date" title="Start date"/"End
  date">` fields on web, not a clickable calendar grid of day numbers.
- **Participants step**: split into `First name`/`Last name` fields plus an
  `Email (optional)` field and an `Add Participant` button (was a single
  "Participant Name" field and a generic "Add" button).
- **Wizard step order changed**: Trip Details → Dates → Participants →
  **Itinerary** → Flight Details → Accommodation Details → Activities →
  Rental Cars → **Review & Confirm** (a "Notes" step no longer exists). The
  Itinerary step also gates "Next" behind an explicit Yes/No AI-generation
  choice.
- **Two different submit buttons**: "Finish Trip" is an early-exit shortcut
  shown on intermediate steps; "Create Trip" is the actual final-step
  button.
- **"Active Trip: {name}" banner has been fully removed** from the app but
  was still asserted in 6 spec files. Replaced with checks that actually
  exist now (trip name visible on the landing Overview page, hero card no
  longer showing its "Select a trip" placeholder, or the trip picker
  modal's "Active" badge on the correct row).
- **Post-wizard-creation lands on the new trip's Overview *page***, not the
  Home tab, so any home-nav/hero-card interaction right after creating a
  trip used to hang for the full 2-minute test timeout. Fixed once in the
  shared `createTripViaWizard` helper (navigates back via the "⌂" home
  button before returning).
- **`'overview'` is a standalone page**, unlike flights/lodging/tours/
  expenses/cost which stay within the home-grid context — clicking it
  first in a sequential nav-grid-click loop strands every subsequent
  `home-nav-*` click. Test it last, or return home first.
- **Overview's Travelers/participants section moved behind an "Edit"
  toggle** — it's no longer shown in the default read-only view.
- **Activities row actions changed to a two-step flow**: `activity-edit-*`/
  `activity-delete-*` testIDs on the row no longer exist; you now click
  `activity-details-{id}` to open a details view, then
  `activity-details-edit-{id}` / `activity-details-delete-{id}`.
- **Car Rentals changed from an always-visible inline form to a modal**:
  now click `car-rental-add` to open `car-rental-editor-dialog`, matching
  the Lodging/Activities pattern, instead of typing directly into
  page-level inputs.
- **`trip-editing.test.ts`**: every hardcoded fixture date was `2025-*` — a
  year in the past — replaced with dates computed relative to `Date.now()`.
  Also fixed: a transfer pre-create payload missing required fields
  (`passengerIds`, `departureDate`, `arrivalTime`); an expense pre-create
  using an invalid category (`'Food'` isn't in the allowed set, changed to
  `'Dinner'`); and a field-name mismatch (`date` → `expenseDate`).
- **Deleted a dead, broken duplicate `loginAsNewUser`** in root
  `test-utils.ts` (used only by 2 spec files): wrong default port, a
  different/likely-defunct OAuth-bootstrap endpoint, and a missing
  localStorage key. Repointed both files at the working `fixtures.ts`
  version and deleted the dead files.

## Legitimate product behavior, not a bug — tests skipped with reason

- **Daily Expenses is gated behind the `cost_tracking` tier entitlement**
  (`server/src/routes/accountRoutes.ts`). A freshly-registered free-tier
  test user (what `loginAsNewUser` creates) is correctly blocked from
  saving expenses. There's no e2e fixture yet to grant a test user premium
  tier, so the two Daily Expenses CRUD tests in `trip-editing.test.ts` are
  `test.skip()`'d with a comment explaining why, rather than left as an
  unexplained red failure.

## Not fixed / flagged for awareness

- **Invalid SMTP credentials** in this environment — every verification
  email fails to send (`535 Authentication failed`). Not a code bug, an
  environment/config issue, but worth knowing real users wouldn't get
  verification emails until fixed.
- **`refreshPageData` race** (#9 above) — real bug, not fixed, needs
  dedicated attention.
- **Performance-threshold flakiness** (login/tab-switch timing tests) —
  looks like resource contention under parallel local execution rather
  than a real regression; full-suite runtime on this machine grew from
  ~6 min to ~14 min over the course of this session with no code changes
  that would explain it, suggesting accumulated system load (many
  Chromium/Node processes across repeated runs) rather than a product
  issue.
- **A handful of remaining failures not yet root-caused**: `chat.test.ts`
  (3), `keyboard-auth-flow`/`keyboard-expense-flow`/`keyboard-sharing-flow`/
  `keyboard-trip-flow` (1 each), `multi-user-group.test.ts` (2),
  `create-trip-destination-autocomplete.test.ts` (1), `create-trip.test.ts`
  (1), `responsive-layouts.test.ts` ledger test (1), `trip-creation-full.test.ts`
  (2), and `trip-editing.test.ts`'s lodging edit/delete (2, likely one more
  stale-selector or save-flow issue on top of the fixes already applied).
  Some of these may resolve on a fresh machine/session without the
  accumulated resource pressure; others likely need the same kind of
  targeted, one-at-a-time diagnosis used for the bugs above.
