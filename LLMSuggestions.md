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

## Priority 1: Durable API Usage Limiting, Budgeting, And Cost Governance

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
