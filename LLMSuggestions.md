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

## Ready-To-Execute First PR Slices

If an LLM agent is picking work from this file, prefer these smallest high-value slices first (refreshed 2026-04-23):
1. Add request-ID propagation through server logs and switch to structured JSON logging in production (Priority 12).
2. Implement an account deletion endpoint with cascade tests (Priority 15).
3. Add a thin migration runner CLI that applies files in `server/migrations/` in order with a `schema_migrations` ledger (Priority 10 slice).
4. Persist admin tab filter/sort state across navigation (Priority 19 slice).
5. Extract a shared workspace package for `coveredBy`/`itineraryStatus` to remove app/server duplication (Priority 11 slice).

Completed earlier slices:
- [x] Fail startup outside local development when `AUTH_SECRET` is missing or defaulted.
- [x] Replace the blanket Firestore authenticated-user rule with collection-scoped rules.
- [x] Extract async itinerary polling from `app/App.tsx` into a tested hook with in-flight suppression.
- [x] Add durable token usage accounting for OpenAI on top of the request-count limiter.
- [x] Add real root/workspace `typecheck` and `lint` scripts so targeted validation is predictable.

## Priority 1: Durable API Usage Limiting, Budgeting, And Cost Governance

Status: `Substantial` (DB-backed durable limiting + OpenAI token/cost accounting are in place; multi-instance/restart integration tests still outstanding)

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

Status: `Substantial` (shared client data layer in `app/utils/apiClient.ts` — `requestJson` + `ApiClientError` — used by `useTripsData` and `useGroupInvites`. Extracted hooks: `useTripsData`, `useAsyncItineraryPolling`, `usePolling`, `useGroupInvites` (new — owns group invites + trip-share invites state + 6 mutations), `usePersistedState`, `useConnectionState`. Types split into `app/types/invites.ts`. `App.tsx` shrank 5507 → 5420 lines. More extraction passes needed before it's top-level-composition only.)

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

Status: `Substantial` (new `server/src/utils/ttlCache.ts` `TtlCache.getOrFetch` unifies TTL + in-flight dedupe + cache_hit/miss metric emission; 9 unit tests. Frankfurter exchange-rate API refactored to adopt it (pattern demonstrated end-to-end, pre-existing tests still green). Image service / Unsplash / googlePlaces caches have not yet been migrated to the shared abstraction.)

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

Status: `Partial`

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

Status: `Substantial` (`packages/domain` workspace package now hosts `itineraryStatus` + `coveredBy` as the canonical pure-logic source; `app/utils/*` re-exports from it, `server/src/utils/*` mirrors inline with a contract test in `server/__tests__/domainSync.test.ts` that catches drift. Typed DTO parsing at route boundaries still outstanding.)

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

Status: `Substantial` (structured JSON logs in production, per-request `requestId`/`userId`/`method`/`path` context via `AsyncLocalStorage`, `X-Request-Id` header propagation, redaction of secret-shaped keys, unit-tested; admin-audit-entry expansion and broader redaction rule review still outstanding)

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

Status: `Substantial` (`reserveGenerationIdempotency`/`completeGenerationIdempotency`/`failGenerationIdempotency` now implemented in both `db.postgres.ts` and `db.firebase.ts`; Postgres SQL refactored to pg-mem-compatible expires_at param and covered by 4 dedicated unit tests in `postgresIdempotency.test.ts`. Itinerary-generation dedup + usage accounting end-to-end test already exists. Dead-letter behavior and cross-instance retry contention tests still outstanding.)

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

Status: `Partial` (`ConfirmDialog` and `LodgingDialog` now expose `accessibilityRole`/`accessibilityLabel`/`accessibilityViewIsModal` on overlay and actionable buttons, with a component test in `confirmDialogAccessibility.test.tsx` that asserts the contract. Systematic audit of remaining ~30 modals and keyboard navigation Playwright coverage still outstanding.)

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

Status: `Partial` (`DELETE /api/account` endpoint cascades ingestion data, owned groups/trips, memberships, invites, flights/lodgings/tours/expenses, traits, family relationships; integration-tested in `accountDelete.test.ts`. Export capability and background retention jobs still outstanding.)

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

Status: `Substantial` (`server/src/metrics.ts` exposes `incrementMetric`/`recordGauge`/`recordTiming`/`timedAsync` helpers emitting structured JSON with request context; wired into itinerary generation success/failure and entitlement denials; 8 unit tests. Feature flags + YAML seed config already existed. Cache-hit/miss metric wiring and dashboard aggregation still outstanding.)

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

Status: `Substantial` (new `useConnectionState` hook tracks combined browser `navigator.onLine` + Socket.IO `connect`/`disconnect`/`reconnect_attempt` events; `OfflineBanner` component surfaces degraded states with accessibility labels; 5 unit tests. Retry affordance for failed writes and offline read-only caches still outstanding.)

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

Status: `Substantial` (admin routes support pagination + filter/sort params; AdminTab user search/page and user-data window/page now persist across navigation via the new `usePersistedState` hook with tests. Bulk actions and explicit empty-state copy still outstanding.)

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

Status: `Partial`

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
