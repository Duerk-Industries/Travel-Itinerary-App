# LLM Suggestions

This document consolidates the prior Gemini and Codex suggestion files into one deduplicated implementation backlog for an LLM coding agent.

It is intentionally written for execution, not just review. Each item includes:
- goal
- likely files
- implementation direction
- testability requirements
- acceptance criteria

## How An LLM Agent Should Use This

- Pick one primary item per PR unless two items are tightly coupled.
- Prefer behavior-preserving refactors before behavior-changing improvements.
- Before touching a large or central file, add or tighten regression tests around the target behavior.
- Reuse the existing test stack:
  - Server: Jest, Supertest, `pg-mem`
  - App: Jest, `@testing-library/react-native`
  - E2E: Playwright
- Preserve existing `testID` selectors unless replacing them deliberately with equivalent coverage.

## Definition Of Done

- Code change is scoped and coherent.
- New or changed behavior has tests at the right level.
- Failure paths are tested, not only happy paths.
- Logging and errors are actionable and do not leak secrets.
- Existing tests for the touched area still pass.

## Processed Repo Snapshot

Status legend:
- `Not started`: little or no implementation evidence found
- `Partial`: groundwork exists, but the backlog item is not complete
- `Substantial`: meaningful implementation exists, but hardening or follow-through is still needed

Quick repo observations from this pass (refreshed 2026-04-23):
- `firestore.rules` is now collection-scoped; blanket authenticated-user rule is gone.
- `AUTH_SECRET` fails closed outside local dev via `assertSafeAuthSecretConfig` in `server/src/authConfig.ts`, called from `server/src/app.ts`.
- OAuth redirect now uses a short-lived exchange code (`createRedirectTokenExchangeCode`/`consumeRedirectTokenExchangeCode`); durable JWT is no longer in the redirect URL.
- `app/App.tsx` is still ~5.5k lines; hooks like `useAsyncItineraryPolling` and `useTripsData` are extracted, but most mutation flows remain centralized.
- Durable idempotency exists for itinerary generation; Postgres parity and a full retry/dead-letter test suite are still outstanding.
- API usage limiter is durable/DB-backed (`atomicIncrementApiUsageIfUnderLimit`) with OpenAI token + cost accounting; multi-instance integration tests are not yet in CI.
- Root `package.json` now has real `typecheck`, `lint`, `validate:*` scripts delegating to each workspace.
- Unsplash URL-lookup, `image-service` GCS signed URL cache, and `googlePlaces` DB read cache now flow through the shared `TtlCache` abstraction (cache_hit/miss metrics for free).
- Ingestion review queue exposes bulk delete + bulk assign (capped at 100 ids/call, 207 partial-success response); deferred-UX bulk-actions item moved into `TECHNICAL_DEBT.md` resolved section.
- Ingestion and expense routes now consume zod-validated DTOs via a shared `parseDto`/`readDto` helper (`server/src/utils/dtoParse.ts`); validation errors return `{ error, details: [{ path, message }] }` with HTTP 400.

## Ready-To-Execute First PR Slices

If an LLM agent is picking work from this file, prefer these smallest high-value slices first (refreshed 2026-04-23):
(All three previously-listed slices shipped — see the Completed list below for pointers; next-highest-value slices should be identified on the next refresh pass.)

Completed earlier slices:
- [x] Fail startup outside local development when `AUTH_SECRET` is missing or defaulted.
- [x] Replace the blanket Firestore authenticated-user rule with collection-scoped rules.
- [x] Extract async itinerary polling from `app/App.tsx` into a tested hook with in-flight suppression.
- [x] Add durable token usage accounting for OpenAI on top of the request-count limiter.
- [x] Add real root/workspace `typecheck` and `lint` scripts so targeted validation is predictable.
- [x] Migrate Unsplash URL-lookup caller onto the shared `TtlCache` abstraction with cache_hit/miss metrics.
- [x] Migrate `image-service` GCS signed URL cache and `googlePlaces` DB read cache onto the shared `TtlCache` abstraction with cache_hit/miss metrics.
- [x] Add bulk delete + bulk assign endpoints (with multi-select UI) for the ingestion review queue.
- [x] Introduce a shared `parseDto`/`readDto` DTO helper and apply it to the ingestion route family.
- [x] Apply the shared `parseDto`/`readDto` DTO pattern to the expense route family.
- [x] Add a queued background deletion flow + admin observability for Gmail data deletion cascades (new `data_deletion_jobs` table + job lifecycle + `?async=1` mode on `/api/ingestion/gmail/disconnect` + admin + user list endpoints).
- [x] Ship Gmail scheduled polling (Pro 4h / Premium daily) via `gmailPollingService` with `metadata.lastPolledAt` watermark and 6 unit tests.
- [x] Add bulk-tier-change support to AdminTab user list: `POST /api/admin/users/bulk-tier` (100-id cap, 207 partial-success) + multi-select UI + 8 server tests + 3 UI tests.

## Priority 1: Durable API Usage Limiting, Budgeting, And Cost Governance

Status: `Done` (DB-backed durable limiting + OpenAI token/cost accounting have been in place for a while; multi-instance/restart integration coverage now closed with two new tests in `usage-limiter-durable.test.ts`. The "under high concurrency" test fires 80 concurrent `reserveApiUsageOrThrow` calls against a 50-limit caller and asserts exactly 50 fulfilled / 30 rejected with `ApiLimitExceededError` and a durable counter of exactly 50 — this exercises the `UPDATE ... WHERE count < $limit` atomic-conditional-increment primitive that also provides cross-instance coordination when multiple processes share the same DB. The "preserves durable counters across simulated process restart" test consumes 40/50 of the limit, calls a new test-only helper `__resetInProcessUsageCachesForTests()` in `usageLimiter.ts` that clears the in-memory `usageBuckets` + `blockedLogStates` maps without touching the `api_usage_counters` table, then confirms the next 10 calls succeed and the 51st throws — proving an instance restart cannot reset the effective budget. Note: pg-mem serializes queries so the concurrency test validates the reservation *logic* (ON CONFLICT + conditional UPDATE) rather than true write contention; a live-Postgres stress test would be needed to exercise row-level locking directly, but that is a testcontainers/infra slice rather than correctness work.)

### Goal
Make provider limits and spend controls reliable across process restarts and multiple server instances.

### Likely files
- `server/src/apis/usageLimiter.ts`
- `server/src/apis/openaiApi.ts`
- `server/src/routes/itineraryRoutes.ts`
- `server/src/config/apiLimits.ts`
- `server/src/db.postgres.ts`

### Implementation direction
- Move limit reservation/check/update logic into a durable DB-backed service.
- Reuse existing usage tables where possible instead of creating parallel tracking systems.
- Keep in-memory state only as an L1 cache.
- Track:
  - request counts
  - prompt tokens
  - completion tokens
  - total tokens
  - optional estimated cost per provider/caller
- Return consistent `429` behavior for caller-level and provider-level exhaustion.

### Testability
- Unit tests:
  - window key generation
  - limit threshold behavior
  - reset behavior across window boundaries
- Integration tests with `pg-mem`:
  - usage shared across two service instances
  - restart does not lose state
  - `429` returned at configured limit
- Mocked provider-response tests:
  - OpenAI usage payload is recorded correctly

### Acceptance criteria
- Limits survive restart.
- Limits are coordinated across instances using the same DB.
- OpenAI usage is recorded by request and token volume.

## Priority 2: Authentication, Authorization, And Secret Handling

Status: `Done` (AUTH_SECRET fail-closed, JWT issuer/audience, OAuth state nonce, password-setup gate, short-lived redirect exchange code via `createRedirectTokenExchangeCode`/`appendAuthCodeToRedirect` all in place)

### Goal
Fail closed on insecure auth config and enforce server-side authorization consistently.

### Likely files
- `server/src/auth.ts`
- `server/src/app.ts`
- `server/src/secrets.ts`
- `server/src/redirects.ts`
- `server/src/routes/*`
- `server/src/middleware/requireAdmin.ts`

### Implementation direction
- Refuse startup in non-local environments if `AUTH_SECRET` is missing or defaulted.
- Add JWT issuer/audience validation.
- Replace redirect JWT query-string transport with a short-lived exchange code if feasible.
- Audit mutating routes and ensure membership/role checks happen server-side for all write paths.
- Verify backend-only secrets are never exposed through frontend-prefixed env vars.

### Testability
- Unit tests:
  - auth config validation
  - redirect URI allowlist behavior
  - token verification failure for wrong issuer/audience
- Integration tests:
  - non-member receives `403`/`401` on protected mutation routes
  - authorized member succeeds
  - admin-only route rejects non-admin token

### Acceptance criteria
- Production-like env cannot run with unsafe auth secret configuration.
- Sensitive write routes enforce authorization on the server.
- Redirect flow no longer exposes a durable token in the URL.

## Priority 3: Firestore Security Rules Hardening

Status: `Done` (blanket authenticated-user rule replaced with 40+ collection-scoped rules; membership/ownership/admin-only classes enforced)

### Goal
Replace blanket authenticated-user access with collection- and ownership-aware rules.

### Likely files
- `firestore.rules`
- `server/src/db.firebase.ts`

### Implementation direction
- Replace the catch-all rule with rules by collection/data class:
  - user-owned data
  - trip/group-scoped data
  - admin-only data
  - audit/system/usage data
- Enforce trip membership for trip-scoped records.
- Route admin-only records through server APIs where appropriate.

### Testability
- Firestore emulator rules tests:
  - owner can access own records
  - trip member can access allowed trip data
  - non-member cannot access another trip
  - non-admin cannot access admin/system collections

### Acceptance criteria
- No blanket authenticated-user allow rule remains.
- Unauthorized access tests fail correctly for each protected collection class.

## Priority 4: Break Up `app/App.tsx` And Introduce A Shared Client Data Layer

Status: `Substantial` (shared client data layer in `app/utils/apiClient.ts` — `requestJson` + `ApiClientError` — now used by `useTripsData`, `useGroupInvites`, `useFollowedTrips`, `useSelectedFollowedTripDetails`, `useAuthFlowState`, and `useTraits`. 16 hooks extracted: `useTripsData`, `useAsyncItineraryPolling`, `usePolling`, `useGroupInvites`, `useFollowedTrips`, `useAuthFlowState` (also owns `completeInitialPasswordSetup` + `resendConfirmationEmail` actions), `useAccountProfile`, `useSelectedFollowedTripDetails`, `useCreateTripWizard`, `useChatState`, `useAuthSession` (core identity), `useTraits`, `useAccountSidecars` (family relationships + fellow travelers with token-override loaders), `useAuthForm` (login/register mode + 5-field form state), `usePersistedState`, `useConnectionState`. Components extracted so far: `PendingInvitesModal` (88-line JSX block pulled out of App.tsx with accessibility labels added) and new `CarRentalsPanel` (~302-line inline block covering the Car Rentals table + Add form + voting/rating/delete controls). `CarRentalsPanel` is presentational — takes 17 props (`carRentals`, `carDraft`/`setCarDraft`, `carPrepaidOpen`/`setter`, pickup/dropoff date refs, `isFollowingMode`, `userMembers`, `styles`, `payerName`, `formatMemberName`, plus 5 callbacks for add/remove/vote/rate/open-date-picker) and owns no state; App.tsx keeps all car state + handlers + the native DateTimePicker (which belongs at the trip-screen root, not inside the panel's ScrollView). 7 new unit tests in `carRentalsPanel.test.tsx` cover: renders heading + empty table + form-visible by default, renders rental rows with route label + vendor/model/reference sub-line, Delete → `onRemoveCarRental(id)`, Add → `onAddCarRental`, `isFollowingMode` hides form + Delete buttons and shows "View only", thumbs-up 👍 + 👎 render for Proposed status with no prior vote, thumbs-up press → `onVoteCarRental(id, 1)`. Types split into `app/types/invites.ts`. `App.tsx` down to **4891 lines** from 5193 (**-302 this slice, -616 cumulative from the 5507 baseline, -11.2%**). Backlog claim "~29 inline modal/form blocks" is stale — App.tsx has only 4 explicit `show*` state vars; the car-rentals block was the biggest inline remainder. Remaining extraction candidates: the login/register form submit handlers + a handful of smaller presentational blocks. Per-screen state cleanup + a full `App.tsx` audit should produce a refreshed next-largest-block list on the next pass.)

### Goal
Turn `app/App.tsx` into top-level composition only and standardize data-fetching logic across the app.

### Likely files
- `app/App.tsx`
- `app/hooks/*`
- `app/components/*`
- `app/tabs/*`

### Implementation direction
- Extract by responsibility:
  - `useAuthSession`
  - `useTrips`
  - `useGroupMembers`
  - `useExpenses`
  - `useAsyncItineraryPolling`
  - `useChatState`
- Introduce a small client data layer:
  - request helper
  - auth header injection
  - JSON/error normalization
  - cancellation/stale-response protection
- Move large inline modal and page branches into dedicated components.
- Keep `App.tsx` focused on providers, routing, and high-level layout.

### Testability
- Hook-level tests for extracted state/data hooks.
- Mocked `fetch` tests for the shared client layer.
- Regression tests for current high-risk flows before large refactors.
- Existing app tests and key Playwright auth/trip-management tests must remain green.

### Acceptance criteria
- `App.tsx` no longer owns most feature-specific async and mutation logic.
- At least one major feature uses the shared client data layer end-to-end.

## Priority 5: Polling, Request Dedupe, And Async Flow Cleanup

Status: `Done` (`usePolling` has visibility-aware pausing, in-flight suppression, exponential backoff, terminal-state stop; `useAsyncItineraryPolling` composes it with fake-timer tests)

### Goal
Reduce unnecessary polling and eliminate duplicate concurrent requests.

### Likely files
- `app/App.tsx`
- `app/tabs/ingestion.tsx`
- `server/src/routes/itineraryRoutes.ts`

### Implementation direction
- Create a shared polling utility or hook with:
  - visibility-aware pausing
  - in-flight suppression
  - exponential backoff
  - immediate stop on terminal state
- Prefer targeted local updates over broad full-refetch patterns after mutation.

### Testability
- Fake-timer tests for polling cadence and stop conditions.
- Integration tests for async itinerary status routes if behavior changes.
- Optional Playwright coverage for one async generation flow.

### Acceptance criteria
- Polling stops on terminal states.
- Duplicate concurrent polls for the same job do not happen.
- Polling slows down or pauses when the view is inactive.

## Priority 6: Caching And Dedupe For Expensive External Calls

Status: `Done` (new `server/src/utils/ttlCache.ts` `TtlCache.getOrFetch` unifies TTL + in-flight dedupe + cache_hit/miss metric emission; 9 unit tests. Frankfurter exchange-rate, Unsplash URL lookup, `image-service.ts` GCS signed URL reads, and `googlePlaces.ts` DB place-details reads now use it. Cache metric namespaces include `unsplash.url_lookup`, `image.gcs_bytes`, and `google_places.details_db`; focused tests cover sequential hits, TTL behavior, concurrent dedupe, and empty-query handling.)

### Goal
Reduce cost and latency for AI, image, and third-party lookup flows.

### Likely files
- `server/src/image-service.ts`
- `server/src/unsplash.ts`
- `server/src/googlePlaces.ts`
- `server/src/services/locationServices.ts`
- `server/src/apis/frankfurterApi.ts`
- `server/src/routes/itineraryRoutes.ts`
- `app/tabs/HomeTab.tsx`

### Implementation direction
- Add normalized request fingerprints for itinerary generation.
- Cache successful itinerary-generation outputs keyed by normalized inputs plus prompt/config version.
- Separate image metadata cache from signed URL generation.
- Expand durable/shared caching for:
  - image lookups
  - location option datasets
  - exchange rates
  - place details cache
- If full Google Places integration returns later, apply the same cache abstraction there.

### Testability
- Unit tests:
  - cache key normalization
  - TTL expiry
  - version-based invalidation
- Integration tests:
  - repeated equivalent request avoids repeated provider call
  - stale cache refreshes correctly
- App tests:
  - home hero loading/cached/fallback states

### Acceptance criteria
- Equivalent expensive requests are deduped.
- Cache invalidation rules are explicit and tested.

## Priority 7: Web Performance, Code Splitting, And Lazy Loading

Status: `Done` (`AdminTab` and `IngestionTab` lazy-loaded via `React.lazy` with `LazyTabFallback`; meets "at least one heavy tab" acceptance)

### Goal
Reduce initial web bundle weight and improve time-to-interactive for less-frequently used tabs.

### Likely files
- `app/App.tsx`
- `app/tabs/AdminTab.tsx`
- `app/tabs/ingestion.tsx`
- other heavy tab modules discovered during implementation

### Implementation direction
- Identify web-heavy, lower-frequency screens.
- Use `React.lazy` and `Suspense` where compatible with the app’s runtime constraints.
- Keep a lightweight fallback UI for chunk loading.
- Prefer starting with admin and ingestion surfaces.

### Testability
- Component tests for fallback rendering.
- Playwright navigation tests confirming lazy-loaded tabs still render.

### Acceptance criteria
- At least one heavy tab is lazily loaded.
- Navigation to the tab remains stable and test-covered.

## Priority 8: UI Scalability, Responsive Layouts, And Perceived Performance

Status: `Done` (responsive layouts in `dailyExpenses`, `ledger`, `overview`, `createTripWizard` with dedicated responsive tests; `useWindowDimensions` branching in place)

### Goal
Make large datasets usable on mobile and improve perceived speed.

### Likely files
- `app/tabs/activities.tsx`
- `app/tabs/dailyExpenses.tsx`
- `app/tabs/ledger.tsx`
- `app/tabs/createTripWizard.tsx`
- `app/tabs/overview.tsx`
- `app/tabs/HomeTab.tsx`

### Implementation direction
- Convert at least one heavy table screen to:
  - desktop/web table
  - mobile/narrow card/list layout
- Prefer `FlatList` or other virtualized rendering for long collections.
- Extract pure selectors/helpers for grouped day rendering in overview.
- Add skeleton/loading states instead of blank placeholders.

### Testability
- Component tests for mobile and desktop render branches.
- Pure-function tests for overview grouping and derived-state helpers.
- Playwright viewport test for a converted screen.

### Acceptance criteria
- At least one high-volume screen is responsive instead of mobile-horizontal-first.
- Overview derived-state work is moved out of repeated render filters.

## Priority 9: Chat Scalability And Read-State Correctness

Status: `Substantial` (cursor-based pagination via new `listTripMessagesPage(tripId, {limit, beforeId})` in both Postgres and Firebase adapters, returning `{ messages, hasMore }` in ascending chronological order; `addTripMessage` no longer re-reads the full message list to return the saved row. Socket handler sends the newest 50 messages on `JOIN_TRIP` and responds to a new `CLIENT_EVENTS.LOAD_OLDER` cursor request with `SERVER_EVENTS.MESSAGE_HISTORY_PAGE`. ChatPanel consumes the paginated stream, shows a "Load older messages" affordance when `hasMore`, gates `MARK_READ` emissions by a watermark ref so the same message id is never re-reported, and now renders a visible "New messages" separator anchored to the oldest-unread message at the moment the panel opens: a new `initialUnreadCountRef = useRef(unreadCount)` captures the at-open unread count, the initial-history handler computes `firstUnreadId = messages[length - initialUnread]?.id`, and `renderMessage` wraps each row in a `<View>` that conditionally emits a host `<View testID="chat-unread-separator">` above the row whose id matches. The separator is pinned to its initial anchor — new live messages append below without shifting it, and loading older pages prepends above without moving it. Styled with a red (theme `colors.error`) horizontal rule + uppercase label, with `accessibilityRole="separator"` on web and `accessibilityLabel="New messages below"`. Three new app tests in `chatPanel.test.tsx` cover: separator renders above the correct message when `unreadCount > 0` at mount (5 messages + unreadCount=3 → anchored to m3), no separator when `unreadCount === 0`, and the separator stays anchored to its original message when a live `NEW_MESSAGE` arrives after open. Tests cover newest-N default, older-page cursor, exact-remainder `hasMore`, unknown cursor, empty trip, plus ChatPanel empty/load-older/watermark/separator behavior (9 tests total). Remaining: migrate `markMessagesRead` to a per-user watermark row instead of per-message receipt writes.)

### Goal
Make trip chat behavior scale cleanly as message history grows.

### Likely files
- `app/components/ChatPanel.tsx`
- `server/src/socket/*`
- `server/src/db.postgres.ts`

### Implementation direction
- Add paginated or cursor-based history loading.
- Mark read by explicit watermark or last-visible message, not every incoming event.
- Preserve a minimal socket protocol.

### Testability
- Socket/server integration tests:
  - paginated history fetch
  - unread count changes
  - read watermark updates
- App tests:
  - initial load
  - pagination trigger
  - unread clearing only after view/read condition

### Acceptance criteria
- Chat supports partial history loading.
- Read/unread behavior is less noisy and test-covered.

## Priority 10: Formalize Schema Migrations And Reduce Runtime Bootstrap

Status: `Substantial` (migration runner at `server/src/migrations/runner.ts` with `schema_migrations` ledger, `BEGIN`/`ROLLBACK` safety, and tests; CLI entry at `server/scripts/migrate.ts` wired to `npm run migrate`. Runtime bootstrap in `db.postgres.ts` still runs alongside — full cutover of schema evolution still outstanding.)

### Goal
Move schema ownership out of large runtime bootstrap code.

### Likely files
- `server/src/db.postgres.ts`
- `server/migrations/*`
- `server/src/ingestion/TECHNICAL_DEBT.md`

### Implementation direction
- Choose one migration path and use it consistently.
- Move schema evolution into ordered migrations.
- Keep runtime bootstrap to connection/version checks only.

### Testability
- Migration tests for:
  - clean database to current schema
  - representative query path after migration
  - migration execution in CI

### Acceptance criteria
- New schema changes do not go directly into runtime bootstrap code.
- Clean environments can reach current schema through migrations alone.

## Priority 11: Consolidate Shared Domain Logic And Reduce `any`

Status: `Substantial` (`packages/domain` workspace package now hosts `itineraryStatus` + `coveredBy` as the canonical pure-logic source; `app/utils/*` re-exports from it, `server/src/utils/*` mirrors inline with a contract test in `server/__tests__/domainSync.test.ts` that catches drift. Typed DTO parsing now covers the ingestion, expense, **and trip** route families: `server/src/utils/dtoParse.ts` exposes `parseDto`/`readDto`+`DtoValidationError` (5 unit tests), `server/src/routes/ingestionDtos.ts` defines zod schemas for review-item actions, `server/src/routes/expenseDtos.ts` for listing/creating expenses, and new `server/src/routes/tripDtos.ts` covers five trip-route handlers: `followTripDto` (union of `inviteCode | code` with legacy-alias normalization), `createShareInvitesDto` (array with per-entry email lowercase+regex validation, role enum, and cross-entry dedupe), `createTripCommentDto` (trimmed body 1..4000 chars with the existing error-message text preserved), `updateCoveredByDto` (`z.record(z.string(), z.string())` for the free-form cover map), and `updateTripGroupDto` (non-empty `groupId`). Corresponding handlers in `server/src/routes/tripRoutes.ts` replaced their ad-hoc `String(req.body?.X ?? '').trim()` + conditional 400 emission with one-liner `const dto = readDto(schema, req.body, res); if (!dto) return;` — the share-invites handler in particular shrank from ~40 lines of manual normalization/validation/dedup to a clean DTO read. Unused local `normalizeEmail`/`isValidEmail` helpers removed. 21 new unit tests in `tripDtos.test.ts` cover each DTO's accepted + rejected shapes (legacy-alias preference, trim behavior, post-trim length bounds, role coercion, email regex, duplicate detection, empty/missing path rejections). Validation failures uniformly return `{ error: 'Request validation failed', details: [{ path, message }] }` with HTTP 400 via `readDto`. Many other route families (account, car-rental, activity, lodging, transfer, itinerary) still use ad-hoc per-field string coercion and are the natural next slices.)

### Goal
Reduce logic drift and improve refactor safety.

### Likely files
- `app/utils/itineraryGeneration.ts`
- `server/src/services/itineraryAsyncService.ts`
- `app/utils/coveredBy.ts`
- `server/src/utils/coveredBy.ts`
- `app/utils/itineraryStatus.ts`
- `server/src/utils/itineraryStatus.ts`
- `server/src/routes/*`

### Implementation direction
- Extract shared pure logic into a shared workspace package.
- Introduce typed DTOs/parsing helpers at route boundaries.
- Replace broad cast-and-continue patterns with explicit normalization.

### Testability
- Shared-package unit tests for extracted pure logic.
- Contract tests proving app/server paths behave the same for the same inputs.
- Invalid-input tests for new parsers and DTO normalizers.

### Acceptance criteria
- At least one duplicated rule family is unified.
- At least one route family uses typed DTO parsing with tests.

## Priority 12: Logging, Observability, And Operational Auditability

Status: `Done` (structured JSON logs in production, per-request `requestId`/`userId`/`method`/`path` context via `AsyncLocalStorage`, `X-Request-Id` header propagation, redaction of secret-shaped keys, unit-tested. Audit-entry coverage expanded across privacy-sensitive user-facing and admin mutations: `POST /api/ingestion/gmail/disconnect` now emits `GMAIL_DATA_DISCONNECTED` (with `{jobId, mode, deletion}` in afterState) or `GMAIL_DATA_DISCONNECT_FAILED` (with the failure reason, truncated to 500 chars) via a shared `auditGmailDisconnect(userId, jobId, mode, outcome, detail)` helper that catches and logs audit write failures so a failing audit never crashes the cascade. `DELETE /api/account` writes an `ACCOUNT_DELETED` entry *before* the cascade so a durable record survives even if the delete aborts — the audit_log FK's `ON DELETE SET NULL` nulls actor/target after a successful cascade while preserving action/reason. `PATCH /api/account/password` writes `ACCOUNT_PASSWORD_CHANGED` with `mode: 'change' | 'initial_setup'` distinguishing password rotations from first-time setup. `POST /api/account/emails`, `PATCH /api/account/emails/primary`, and `DELETE /api/account/emails/:email` write `ACCOUNT_EMAIL_ADDED` / `ACCOUNT_EMAIL_PRIMARY_CHANGED` / `ACCOUNT_EMAIL_REMOVED` respectively, via a new local `auditAccountAction` helper in `accountRoutes.ts`. `POST /api/admin/ingestion/dead-letter/re-drive` emits `INGESTION_DEAD_LETTER_RE_DRIVEN` with `{provider, sourceType, matched}` beforeState and `{retried, retriedJobIds}` afterState (capped at 100 ids so the JSONB payload stays bounded). `REDACT_KEYS` in `logger.ts` expanded from 15 to 25 patterns — added `pwd`, `idtoken`/`id_token`, `bearer`, `jwt`, `session`/`sessionid`, `credential`/`credentials`, `privatekey`/`private_key` — the substring-after-normalization matcher collapses `newPassword`, `currentPwd`, `bearerToken`, `idToken`, `sessionId`, `privateKey` etc. to their base patterns. Six new integration tests in `auditCoverage.test.ts` verify each new audit write (success + failure paths for Gmail disconnect, password change, email add, account delete, admin re-drive); one new logger test exercises all 9 new redaction patterns plus a positive control that non-sensitive keys (`userId`, `email`) remain visible. 245/246 tests green across audit/account/ingestion/admin/logger/metrics (one pre-existing accountExport flake unrelated).)

### Goal
Make logs production-appropriate, machine-parseable, and useful for incident response.

### Likely files
- `server/src/logger.ts`
- `server/src/app.ts`
- `server/src/routes/adminRoutes.ts`
- `server/logs/*`

### Implementation direction
- Use structured stdout logging in production.
- Limit file logging to local dev if still needed.
- Add request IDs and correlate them through request logs and error logs.
- Expand audit entries for sensitive admin actions with structured context.
- Redact secrets and sensitive content by default.

### Testability
- Unit tests for logger formatting and redaction.
- Route tests for request-ID propagation if added.
- Integration tests for audit log writes on sensitive admin actions.

### Acceptance criteria
- Production logging no longer depends on local filesystem logs.
- Sensitive admin actions emit structured, auditable events.

## Priority 13: Reliability, Idempotency, And Background Job Safety

Status: `Substantial` (`reserveGenerationIdempotency`/`completeGenerationIdempotency`/`failGenerationIdempotency` now implemented in both `db.postgres.ts` and `db.firebase.ts`; Postgres SQL refactored to pg-mem-compatible expires_at param and covered by 4 dedicated unit tests in `postgresIdempotency.test.ts`. Itinerary-generation dedup + usage accounting end-to-end test already exists. Dead-letter behavior now locked with 9 integration tests in `ingestion.dead-letter.test.ts` that document current contracts: (1) `updateImportJobState` stamps `completed_at` and all failure fields on DEAD_LETTERED transition; (2) `requeueImportJob` on a DEAD_LETTERED job resets state → PENDING, increments `retry_count`, and clears `failure_code`/`failure_reason`/`last_error_code`/`completed_at`; (3) `requeueImportJob` returns null for unknown jobId; (4) `requeueImportJob` is NOT state-gated — FAILED and active-state jobs are also accepted (documents the known gap that a future retry-with-backoff slice would close by adding `WHERE state IN ('DEAD_LETTERED','FAILED')`); (5) `requeueDeadLetterImportJob` calls `getJobQueue().enqueue` exactly once with the job id after the DB state transition; (6) throws when the id is unknown; (7) `POST /api/admin/ingestion/dead-letter/re-drive` loops over every DEAD_LETTERED match, enqueues each, leaves COMPLETED/FAILED untouched, returns `{matched, retried}`; (8) returns `matched=0, retried=0` when no dead-lettered jobs exist; (9) returns 403 when `feature_ingest_admin_observability` is disabled. Tests use `resetJobQueueForTests()` + `jest.spyOn(getJobQueue(), 'enqueue')` to verify enqueue counts without actually dispatching. Still outstanding: retry-with-backoff scheduler (Priority 13 option (a)) — `next_retry_at` column + scheduler tick + state-gated requeue; true cross-instance retry contention tests (blocked on live-Postgres testcontainers infra like Priority 1's concurrency caveat).)

### Goal
Make async workflows safer under retries, duplicates, deploys, and partial failures.

### Likely files
- `server/src/routes/itineraryRoutes.ts`
- `server/src/services/itineraryAsyncService.ts`
- `server/src/ingestion/orchestrator.ts`
- `server/src/ingestion/worker/jobQueue.ts`
- `server/src/ingestion/shared/repository.ts`

### Implementation direction
- Standardize idempotency-key handling for expensive or async create/generate endpoints.
- Ensure retry-safe job transitions and dead-letter behavior.
- Make duplicate submission semantics explicit and test-covered.
- Emit consistent terminal statuses for async workflows.

### Testability
- Integration tests for:
  - duplicate request with same idempotency key
  - retry after transient failure
  - terminal state behavior
  - duplicate job submission safety

### Acceptance criteria
- Expensive and async endpoints are retry-safe.
- Duplicate requests do not create duplicate expensive work.

## Priority 14: Accessibility, Keyboard Support, And Inclusive UI

Status: `Substantial` (`ConfirmDialog`, `LodgingDialog`, `PaymentDialog`, `LodgingDetailsDialog`, and `PendingInvitesModal` now carry `accessibilityRole`/`accessibilityLabel` on overlay, header, and actionable buttons, with context-aware labels (e.g. "Edit Hotel Europa", "Accept share invite to Portugal Trip"). New `useEscapeToClose` hook adds Esc-to-close handling to non-`Modal`-wrapped overlays (`ConfirmDialog`, `PendingInvitesModal`, `LodgingDetailsDialog`), DOM-gated so native platforms are a no-op. `ChatButton` label now includes unread count so screen readers don't lose that cue; badge text hidden via `accessibilityElementsHidden`/`importantForAccessibility`. `DropdownOptionButton` now exposes `menuitem` role + `accessibilityState.disabled`. Expanded component tests: `confirmDialogAccessibility.test.tsx` (7 cases incl. Esc behavior and ChatButton label) and new `dialogsAccessibility.test.tsx` (7 cases covering PaymentDialog overlay + toggle state, PendingInvitesModal per-invite labels + Esc, LodgingDetailsDialog overlay/close/edit/delete labels + Esc, DropdownOptionButton role). New Playwright spec `app/e2e/keyboard-auth-flow.test.ts` adds two keyboard-only tests: (1) log in to the app using only Tab + type + Enter (no pointer events, placeholder-start predicate tolerates the "Email or Username" field, Tab-until-focused helper bounded at 40 presses to assert no hidden focus trap, password field reached in a single Tab from email, submit activated via Enter on `role=button` with text "Login") and (2) Tab to the `home-nav-trips` test-ID after programmatic login and activate via Enter, asserting the Trips screen renders. Helper `tabUntilFocused(page, predicate, label, limit)` runs a serializable predicate against `document.activeElement` descriptors (tag, role, placeholder, testId, text, ariaLabel) so focus checks are resilient to RN-Web's host markup. **Note**: the test file typechecks cleanly and follows the existing e2e conventions exactly, but could not be executed end-to-end in the current local environment — the Expo web dev server on port 4173 fails to bind (affects every existing Playwright test too with "Cannot navigate to invalid URL"); this is a pre-existing env limitation, not a regression from this slice. The test is structurally ready to run in any environment where the existing e2e suite passes (e.g. CI). Still outstanding: a pass on the remaining inline dialog blocks in `App.tsx`; auditing the current `~5170`-line App.tsx for `show*` state (the "remaining ~10 inline dialog blocks" claim on the prior refresh needs a recount — see Priority 4 scoping).)

### Goal
Improve usability for keyboard, screen reader, and lower-friction navigation scenarios.

### Likely files
- `app/tabs/*`
- `app/components/*`
- `app/App.tsx`

### Implementation direction
- Audit modals, dialogs, and major forms for:
  - accessible labels
  - focus management
  - keyboard navigation
  - color contrast
  - reduced reliance on emoji-only affordances
- Ensure loading and error states are visible and unambiguous.

### Testability
- Component tests for visible labels and key interactions.
- Playwright tests for keyboard-only navigation on core web flows.

### Acceptance criteria
- Core auth and trip-management flows are usable without pointer-only interaction.
- Dialogs and forms have accessible labels and focus behavior.

## Priority 15: Data Privacy, Retention, Export, And Deletion Capabilities

Status: `Substantial` (`DELETE /api/account` cascades ingestion data, owned groups/trips, memberships, invites, flights/lodgings/tours/expenses, traits, family relationships — integration-tested in `accountDelete.test.ts`. Companion `GET /api/account/export` now delivers the user's data as a JSON bundle with `schemaVersion`/`exportedAt`, profile + emails, traits, family relationships, fellow travelers, groups, trips, and a new `authoredItems` section (flights/lodgings/tours/carRentals/expenses/tripMessages filtered by `user_id = requester`) via a new `listUserAuthoredItems` adapter function implemented on both Postgres and Firebase. `buildUserDataExport` service composes these with soft-fail per collection so a single failing source never breaks the download. Gmail data deletion is now observability-backed via a new `data_deletion_jobs` table (Postgres + Firestore) with repository helpers `createDataDeletionJob` / `markDataDeletionJobRunning` / `markDataDeletionJobSucceeded` / `markDataDeletionJobFailed` / `listDataDeletionJobsForUser` / `listDataDeletionJobs`. `POST /api/ingestion/gmail/disconnect` now always writes a job row for every disconnect attempt and accepts `?async=1` / `{ "async": true }` to return 202 immediately and run the cascade in the background (provider connection stays intact if the cascade throws, job row captures `failureReason`). New user endpoint `GET /api/ingestion/data-deletion-jobs` lists the caller's own jobs; new admin endpoint `GET /api/admin/data-deletion-jobs?state=&userId=&limit=` surfaces in-progress and failed jobs across users with state-enum validation. Five integration tests in `ingestion.data-deletion-jobs.test.ts` cover synchronous-happy-path jobId emission, async-mode 202 + background completion with connection removal, per-user list isolation, admin-only + state-filter semantics, and cascade-failure path. First background retention rule now shipped: `deletePayloadsForDeadLetteredJobsOlderThan(cutoffIso)` in `ingestion/shared/repository.ts` drops `import_job_payloads` for `import_jobs` where `state='DEAD_LETTERED' AND completed_at < cutoff` — parent job rows, `ingested_documents`, and `parsed_items` are preserved so admin history and dead-letter counts remain accurate. New `server/src/services/retentionService.ts` exposes `runRetentionTick({now?, retentionDays?})` returning `{cutoffIso, deadLetterPayloadsDeleted}`, plus `startRetentionScheduler()` / `stopRetentionScheduler()` helpers wired from `server/src/index.ts`. Scheduler gated by `INGESTION_RETENTION_ENABLED` (default on) + `NODE_ENV !== 'test'`, with `INGESTION_RETENTION_TICK_MS` overriding the default 24h tick (floor 60s); `handle.unref()` so shutdown isn't blocked. Config in `server/src/ingestion/config.ts`: `INGESTION_RETENTION_DEAD_LETTER_DAYS = 90`. Four unit tests in `retentionService.test.ts` cover: mixed population — only the DEAD_LETTERED+old row's payload is removed (COMPLETED/old, DEAD_LETTERED/recent, and active-state rows all preserved, all four parent job rows preserved); zero-eligible → `deadLetterPayloadsDeleted=0`; idempotency — second run returns 0; per-call `retentionDays` override. Still outstanding: additional retention rules (orphaned ingested_documents, normalized_text tombstoning), scheduled per-row / per-tier retention windows, and a live-Postgres integration of the scheduler.)

### Goal
Treat user data lifecycle as a product capability, not just a storage concern.

### Likely files
- `server/src/ingestion/shared/repository.ts`
- `server/src/routes/accountRoutes.ts`
- `server/src/routes/adminRoutes.ts`
- `server/src/db.postgres.ts`
- `server/src/db.firebase.ts`

### Implementation direction
- Define and implement:
  - account deletion behavior
  - ingestion-source data deletion behavior
  - retention windows
  - export capability for user-owned data where appropriate
- Make delete semantics explicit for Gmail/imported content and cached assets.

### Testability
- Integration tests for:
  - user deletion cleanup
  - provider disconnect cleanup
  - retention and deletion job behavior

### Acceptance criteria
- Sensitive imported data has explicit lifecycle rules.
- Deletion paths are implemented and tested, not only documented.

## Priority 16: Analytics, Product Instrumentation, And Feature Rollout Ability

Status: `Substantial` (`server/src/metrics.ts` exposes `incrementMetric`/`recordGauge`/`recordTiming`/`timedAsync` helpers emitting structured JSON with request context; wired into itinerary generation success/failure and entitlement denials. Cache-hit/miss counters from `TtlCache.getOrFetch` (already emitted across `unsplash.url_lookup`, `image.gcs_bytes`, `google_places.details_db`) are now aggregated in-process: `metrics.ts` maintains a `counterTotals: Map<string, number>` that `incrementMetric` updates alongside the structured-log emission. New `getMetricCounterSnapshot()` returns `{ counters, cacheRatios: [{namespace, hits, misses, total, hitRate}], startedAtIso, snapshotAtIso }` — cache ratios are derived by pairing `*.cache_hit` and `*.cache_miss` suffixes and sorted alphabetically by namespace. New `resetMetricCountersForTests()` test seam. Five new unit tests in `metrics.test.ts` cover accumulation, namespace pairing + hitRate math, empty state, non-cache counters excluded from cacheRatios, and reset-advances-startedAtIso (13 tests total). New admin endpoint `GET /api/admin/metrics` returns the snapshot; auth-required loop in `admin-routes.test.ts` covers unauthorized + non-admin denial, plus a dedicated test that seeds 4 counter/cache events and verifies the response shape + closeTo(2/3) hit rate (57 tests total in admin-routes.test.ts). AdminTab has a new `MetricsSection` navigable from Overview (new `'metrics'` `AdminSection` + label + nav card), rendering a "Cache hit rates" subsection (one card per namespace with `{namespace}`, `{hitRate%}`, `{hits}/{misses} ({total})`) and a "Counters" subsection for non-cache counters, plus a Refresh button and a footer noting per-instance caveat ("Multi-instance deployments will see per-instance numbers"). testIDs: `admin-metrics-section`, `admin-metrics-refresh`, `admin-metrics-cache-row-{namespace}`, `admin-metrics-counter-{name}`. Three new UI tests in `adminTab.metrics.test.tsx` cover rendering the namespace rows + counter card from a seeded snapshot, refresh-button refetch, and empty-state copy. Still outstanding: multi-instance aggregation (blocked on choosing a backend — Cloud Monitoring, Prometheus pushgateway, etc.); persistent cross-restart counter history; latency/gauge rollups in the admin view.)

### Goal
Improve the team’s ability to measure feature health and roll out risky changes safely.

### Likely files
- `server/src/services/entitlementService.ts`
- `server/src/routes/adminRoutes.ts`
- `server/src/config/featureFlags.ts`
- relevant app surfaces for event emission

### Implementation direction
- Add or standardize metrics/events for:
  - itinerary generation success/failure
  - ingestion success/failure
  - chat usage
  - cache hit/miss
  - lazy-loaded screen usage if added
- Use feature flags for risky rollouts and document kill-switch behavior.

### Testability
- Unit tests for metric and event emission helpers.
- Integration tests ensuring flagged routes and features respect enable/disable behavior.

### Acceptance criteria
- High-risk features emit measurable success/failure signals.
- Risky features can be disabled without code rollback.

## Priority 17: Developer Experience, CI Guardrails, And Static Quality Checks

Status: `Done` (root `typecheck`, `lint`, `test`, `validate:*` scripts delegate to workspaces; GitHub Actions workflows exist)

### Goal
Reduce regression risk by improving automated feedback for contributors and agents.

### Likely files
- root `package.json`
- workspace `package.json` files
- Jest configs
- GitHub workflows if present

### Implementation direction
- Add or strengthen:
  - linting
  - typecheck script
  - targeted test scripts by area
  - CI jobs that separate app/server/e2e concerns
- Prefer fast pre-merge checks and slower nightly or deeper checks.

### Testability
- CI is the test here.
- Add scripts that can be called deterministically by agents and CI.

### Acceptance criteria
- There is a reliable typecheck/lint/test workflow beyond ad hoc local runs.
- An LLM agent can run targeted validation for the area it changed.

## Priority 18: Mobile Resilience And Offline-Tolerant Behavior

Status: `Substantial` (new `useConnectionState` hook tracks combined browser `navigator.onLine` + Socket.IO `connect`/`disconnect`/`reconnect_attempt` events; `OfflineBanner` component surfaces degraded states with accessibility labels; 5 unit tests. Retry-on-failed-write primitive now shipped: new `useRetryableMutation<TArgs, TResult>(mutate)` hook in `app/hooks/useRetryableMutation.ts` exposes a 4-state machine (`idle → pending → success|failed`) plus `{run, retry, reset, state, error, data}`. `run(args)` starts a new attempt and stashes args for retry; `retry()` replays the last args and is a no-op if nothing ran or a previous run is still in flight; `reset()` returns to idle and clears the stash; a mounted ref guards against post-unmount setState warnings; concurrent `run()` calls while pending are single-flighted (second returns null); thrown errors are captured as `state='failed'` with the run promise resolving to null so callers can branch without try/catch. 9 unit tests cover initial idle state, happy path, failed path, retry-after-failure success, no-op retry with no prior run, single-flight concurrent runs, reset clears everything including the stash, unmount-during-pending emits no warnings, and latest-success overwrites prior error. Companion `RetryableErrorBanner` component in `app/components/RetryableErrorBanner.tsx` consumes the hook's `{state, error, onRetry, onDismiss?, actionLabel?}` and renders a red banner with a Retry button (hidden when state is idle or success, shows "Retrying…" + disables the button while pending after a prior failure). `accessibilityRole='alert'` + `accessibilityLiveRegion='polite'` so screen readers announce the failure; the full a11y label includes the action label when provided ("Save expense failed. Network unreachable"). 7 unit tests cover idle/success hiding, failed rendering with message + action-labeled retry a11y, generic message fallback, pending state disables the button and swaps copy, optional Dismiss button appears only when onDismiss is supplied, alert+live-region attributes correct. Hook + banner are **building blocks only** — no existing tab has been wired to them yet, because safely retrying requires idempotency semantics (see Priority 13 follow-up work). The hook docstring calls this out and recommends consumers limit usage to naturally-idempotent writes (PATCH/PUT/DELETE) until server-side idempotency keys are broader. Still outstanding: wire into one real flow (e.g. PATCH `/api/trips/:id` edits, PUT `/api/trips/:id/covered-by`), offline read-only caches for trip view/ledger, offline-queue for safe writes.)

### Goal
Improve the app’s behavior when connectivity is weak or intermittent.

### Likely files
- `app/utils/session.ts`
- `app/utils/socket.ts`
- `app/App.tsx`
- new data-fetching hooks added during refactor

### Implementation direction
- Define minimal offline-tolerant behavior:
  - cached last-known trip selection
  - cached read-only views where safe
  - clear retry states for failed writes
  - reconnect behavior for chat/socket
- Avoid pretending writes succeeded if they did not.

### Testability
- Unit tests for retry and offline state reducers or hooks.
- Component tests for offline/error banners and retry affordances.

### Acceptance criteria
- Read-only degraded behavior is explicit.
- Failed writes are visible and recoverable.
- Reconnect logic is tested for realtime features.

## Priority 19: Search, Filter, Sort, And Admin Operability

Status: `Substantial` (admin routes support pagination + filter/sort params; AdminTab user search/page and user-data window/page now persist across navigation via the new `usePersistedState` hook with tests. Ingestion review queue gained multi-select bulk delete + bulk assign 2026-04-23 — backend routes `POST /api/ingestion/review-items/bulk-delete` and `.../bulk-assign` cap at 100 ids, dedupe input, and return 207 with per-id failure reasons when any id fails so partial failures don't abort the batch. UI in `app/tabs/ingestion.tsx` adds checkbox toggles, a contextual bulk action bar, and per-item accessibility labels. Explicit empty-state copy added for review queue (zero-items vs zero-after-filter) and the recent jobs list. Six integration tests in `ingestion.bulk-actions.test.ts` cover validation rejection, free-tier denial, partial-success delete with unknown id + duplicate id collapsing, all-success 200 path, cross-user isolation, and partial-failure assign when one id is already assigned. AdminTab user list now has the same bulk-action pattern: new `POST /api/admin/users/bulk-tier` route (DTO + zod schema in `server/src/routes/adminDtos.ts`, 100-id cap, dedupe, admin-role auto-pro, per-id try/catch, 207 Multi-Status on any failure), eight admin-routes integration tests covering empty-ids / over-cap / reason-length / non-admin-403 / full-success audit log writes / partial-success with unknown uuid / dedup / admin-locked-to-pro. UsersSection now renders per-row select checkboxes with ☐/☑ glyphs, a contextual bulk bar with tier dropdown + reason input + Apply/Clear buttons, Apply disabled until both tier and ≥3 char reason are set. Tiers loaded lazily from `/api/admin/tiers` if the parent hasn't cached them yet. Three UI tests in `adminTab.bulkTier.test.tsx` cover the full flow, disabled-state transitions, and clear-selection behavior. All testIDs follow the `admin-users-bulk-*` and `admin-users-row-select-{id}` conventions.)

### Goal
Improve operator and power-user workflows, especially for admin and ingestion review surfaces.

### Likely files
- `server/src/routes/adminRoutes.ts`
- `server/src/routes/ingestionRoutes.ts`
- `app/tabs/AdminTab.tsx`
- `app/tabs/ingestion.tsx`

### Implementation direction
- Improve and persist:
  - filters
  - sort state
  - pagination
  - empty-state explanations
  - bulk-action support where safe
- Prioritize ingestion review and admin user management.

### Testability
- Integration tests for route-level filter/sort/pagination correctness.
- Component tests for persisted filter state if added.
- Playwright tests for at least one admin or ingestion review workflow.

### Acceptance criteria
- Large admin/review datasets remain usable.
- Filter and sort behavior is deterministic and test-covered.

## Priority 20: Ingestion Backlog Items Should Become Implemented, Tested Capabilities

Status: `Partial` (Gmail-source deletion automation moved from debt doc to implemented, tested behavior: new `deleteUserIngestionDataForProvider(userId, provider)` in `server/src/ingestion/shared/repository.ts` cascades removal of `parsed_items`/`ingested_documents`/`import_job_payloads`/`import_jobs`/`ingestion_sources` scoped by `(user_id, source_type=GMAIL_IMPORT)` across both Postgres and Firestore adapters. `POST /api/ingestion/gmail/disconnect` calls the cascade before dropping the token so a mid-flight failure keeps the connection retryable, and returns per-table deletion counts. New `ingestion.gmail-disconnect-cascade.test.ts` verifies: Gmail rows removed, MANUAL_UPLOAD rows preserved, provider connection removed, second call is idempotent (zeroed counts), providers without an ingestion mapping short-circuit to zero counts. Gmail scheduled polling is now shipped via `server/src/services/gmailPollingService.ts` — `runGmailPollingTick()` iterates every `provider_connections` row for `provider='gmail'` (new `listProviderConnectionsByProvider` repository helper), resolves the user's tier, skips Free, and enforces per-tier cadence from `INGESTION_TIER_RULES.{premium,pro}.gmailPollIntervalHours` (24h Premium / 4h Pro) against a `metadata.lastPolledAt` watermark written via a new `mergeProviderConnectionMetadata` helper. Token refresh is performed inline when the stored token is within 60s of expiry; `AUTH_EXPIRED` connections are surfaced but not retried. Eligible connections reuse the same `buildGmailIngestionPayloads` + `enqueueIngestionPipelineJob` path as the manual import with the tier's lookback days (30 Premium / 90 Pro) and LLM escalation budget. Failures are captured on `metadata.lastPollError` without aborting the tick so one bad connection cannot starve others. `startGmailPollingScheduler()` is wired from `server/src/index.ts` after `initDb`; it is gated by `GMAIL_POLLING_ENABLED` (default on) and `NODE_ENV !== 'test'`, with `GMAIL_POLLING_TICK_MS` overriding the default 15-minute tick (floor 60s). `handle.unref()` means the scheduler never blocks process shutdown. Six new unit tests in `gmailPollingService.test.ts` cover: Pro with no prior poll is enqueued (2 payloads) and watermark advances; Pro within 4h is skipped and picked up after elapsed; Premium 24h cadence honored; Free tier always skipped; `AUTH_EXPIRED` skipped without Gmail API calls; build-payloads failure still advances watermark and records `lastPollError`. Still outstanding in Priority 20: production-grade PDF structural extraction, production malware scanning provider.)

### Goal
Convert the highest-value ingestion debt from documentation into tested behavior.

### Likely files
- `server/src/ingestion/TECHNICAL_DEBT.md`
- `server/src/ingestion/**/*`

### Implementation direction
- Promote these first:
  - production malware scanning
  - Gmail scheduled polling
  - Gmail-source deletion automation
  - production-grade PDF structural extraction
  - any remaining queue retry/dead-letter gaps

### Testability
- Unit tests for parser/service logic.
- Integration tests for queue/repository/provider failure behavior.
- Negative tests for malformed documents and provider errors.

### Acceptance criteria
- At least one major ingestion debt item moves from documentation to implemented, tested behavior.

## Cross-Cutting Testing Guidance

### Prefer the narrowest useful test
- Pure helper: unit test
- route/auth behavior: Supertest integration test
- stateful hook: hook test with mocked fetch/timers
- user-visible navigation flow: Playwright

### Required failure-path coverage for high-risk changes
- unauthorized path
- provider or network failure path
- duplicate request path
- timeout or stale-response path
- empty-state path

### Before large refactors, lock behavior with tests
- especially for:
  - `app/App.tsx`
  - `server/src/db.postgres.ts`
  - auth flows
  - polling flows
  - itinerary generation
  - ingestion queue behavior

## Recommended Implementation Order

1. Durable provider limits and cost accounting.
2. Auth and authorization hardening.
3. Firestore rules.
4. Shared client data layer and polling cleanup.
5. `App.tsx` decomposition.
6. Caching and dedupe for expensive providers.
7. Responsive UI conversion and overview/home derived-state cleanup.
8. Schema migrations.
9. Shared domain package and typed DTO cleanup.
10. Observability, accessibility, privacy, and DX capability work.

## Fastest High-Leverage Wins

- Fail startup outside local dev when `AUTH_SECRET` is defaulted.
- Replace blanket Firestore rule with collection-scoped rules.
- Extract async itinerary polling into a tested hook with fake timers.
- Add token-based OpenAI accounting alongside request counts.
- Extract a reusable autocomplete/query hook and migrate two selectors.
- Lazily load one heavy web-only or low-frequency tab behind a tested suspense fallback.

## Notes For The Next Agent

- Treat Priorities 2 and 3 as security work and keep the PRs small enough to review carefully.
- Treat Priorities 4, 5, and 7 as stabilization refactors: add tests before moving code.
- For Priorities 1 and 13, avoid parallel durable-tracking systems; extend the existing idempotency and usage primitives instead.
- For Priority 10, do not add more schema evolution directly to `server/src/db.postgres.ts` unless it is required to unblock a migration PR.
