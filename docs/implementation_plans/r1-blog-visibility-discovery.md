# R1: blog public visibility discovery

Source: `wanderbunnies-implementation-plan.md`, supplied by the user on 2026-11-02.
Status: R1 implemented and validated locally. No deployment has been performed.
The decisions below were resolved by the user before implementation.

## Existing implementation

| Area | Files opened | Current behavior |
| --- | --- | --- |
| Publication and readiness | `server/src/routes/blogPublicationRoutes.ts`, `server/src/blog/firebasePublicationRepository.ts` | Auto-publication, adult consent epochs, age/default checks, and a blocking alt-text check. |
| Private blog read | `server/src/routes/blogRoutes.ts` | Calls `autoPublishBlogIfEligible` when a traveler opens the blog. |
| Trip privacy action | `server/src/routes/blogAuthoringRoutes.ts` | Stores one trip-level `publicOptOut`; another traveler can clear it. |
| Public document | `server/src/routes/publicBlogRoutes.ts`, `server/src/blog/firebasePublicationRepository.ts` | Uses persisted publication epochs rather than a fresh eligibility evaluation; public responses allow 60 seconds of caching plus 300 seconds of stale revalidation. |
| Scheduled publication | `server/src/services/blogBackgroundWorker.ts`, `server/src/app.ts` | Existing hourly worker with leases; only considers trips currently under way. |
| Date gate | `server/src/utils/blogGoLive.ts` | Approximates trip start by adding one day to UTC. |
| Trip timezone | `server/src/services/tripTimezoneService.ts`, `server/migrations/20261012_add_trip_timezone.sql`, `server/src/db.postgres.ts`, `server/src/db.firebase.ts` | Existing `trips.timezone` / Firestore `timezone`; resolver currently uses the earliest transfer's arrival airport coordinates. Reuse this field. |
| Profile privacy | `server/src/routes/accountRoutes.ts`, `app/components/BlogPublicDefaultToggle.tsx` | Existing `users.blog_default_public` setting and profile switch. |
| Publication UI | `app/tabs/tripBlog.tsx`, `app/components/BlogPublicationChecklist.tsx` | Make private/public, consent UI, and checklist tied to the current gates. |
| Feature flags | `server/config/feature-flags.yaml` | `trip_blog`, `trip_blog_public_sharing`, `trip_blog_alt_text`, and separate indexing flags exist. |
| Regression coverage | `server/__tests__/blog-auto-publish.test.ts` | Existing HTTP and worker tests exercise the current policy. Additional publication, public-reader, security, and client checklist suites were located for review during implementation. |

## Resolved decisions

1. Retain `trip_blog_public_sharing` as the master switch above the three conditions.
2. All existing accounts are test accounts. Opt existing users in once by setting
   their profile default to public; discard unattributed legacy trip-level opt-outs.
   Do not fabricate dates of birth or bypass age/start-date checks. Future personal
   choices remain independent and are not reset on subsequent startup.

## Implementation changes

- Added one server-side evaluator with an injectable clock, local-date age/start
  checks, and every unmet reason. Accessibility reminders are separate from eligibility.
- Added personal opt-out and profile-default opt-in records, early release, and
  transition records for R5 in both database adapters.
- Reused the existing timezone field. Missing zones resolve from the first
  destination coordinates, organizer notification preferences, then UTC.
- Gated public documents, maps, engagement, shared-activity discovery, indexing,
  and new public media-URL responses on fresh eligibility.
- Removed stale public-response caching, publication-on-open, and the default
  adult-consent workflow. The hourly worker also handles ended trips.
- Updated the checklist and personal actions from server-provided eligibility;
  follower access, item audiences, location blurring, and indexing preferences remain.
- Validated midnight, age, guest, opt-out ownership, profile exception, early
  release, optional alt text, migration, and desktop/phone browser behavior.

## Files and migrations

- Policy and storage: `server/src/services/blogVisibilityService.ts` and
  `server/src/blog/visibilityTypes.ts`, `visibilityPostgres.ts`, `visibilityFirebase.ts`.
  Both DB adapters and the facade expose the same new operations.
- Additive SQL migration: `server/migrations/20261108_add_blog_visibility_rules.sql`.
  Adds personal privacy choices, an early-release field, evaluated-state tracking,
  and transition records. The normal migration ledger makes the test-account opt-in
  one-time. Firestore performs its equivalent one-time migration from `initDb`,
  using a migration marker and per-document progress markers for restart safety.
- Publication, private/public reads, engagement consumers, public indexing and
  shared-activity discovery now use the central eligibility evaluator. The old
  consent endpoints are retired; publication epochs remain compatibility projections.
  `server/src/utils/blogGoLive.ts` and its approximate UTC-plus-one-day rule were removed.
- Frontend: `BlogPublicationChecklist`, `BlogPublicDefaultToggle`, `tripBlog`, and
  `PublicTripBlogPage`. Personal privacy actions are available without entering blog
  edit mode. The checklist has three conditions and a separate optional alt-text reminder.
- Tests: new policy/HTTP, SQL migration, Firestore migration, and desktop/mobile
  Playwright coverage; existing consent/alt-text/public-reader fixtures updated to R1.

## Validation

- Backend blog/inspiration regression run: 47 suites passed, 252 tests passed,
  one existing provider-specific test skipped. The new Firestore-only migration
  test is additionally run against the emulator.
- Frontend blog regression run: 31 suites and 155 tests passed.
- Firestore emulator: policy/publication/public-reader and deletion contracts passed;
  one-time existing-account migration also passed, including later privacy choices.
- Real-browser checks passed at 390px and 1280px, including public-page withdrawal.
- App TypeScript and server production build passed.
- SQL migration tested against a database initialized with legacy private-account
  and trip rows, including a second migration-run check. No live database was modified.

## Rollout and scheduling

On normal deployment/startup, apply the SQL migration or allow Firestore `initDb`
to run its one-time test-account opt-in migration. Do not manually re-run the raw
SQL UPDATE statements after rollout. The feature flag's current value is retained.

Reuse the existing hourly blog worker. It now scans ended and future trips as
well as current trips, resolves missing timezones from destination coordinates,
then organizer notification timezone, then UTC, reserves aliases, and records
visibility transitions. Public reads evaluate the current rule independently of
worker state and never use a public response cache.

For a host that suspends idle process timers (such as request-billed Cloud Run),
configure an external hourly scheduler to POST `/api/internal/blog/blog-visibility`
with `X-Ingestion-Worker-Secret` matching `INGESTION_WORKER_SHARED_SECRET`.
The authenticated endpoint is included; no hosted scheduler or production
infrastructure was provisioned in this code change. A live deployment and hosted
scheduler configuration remain rollout tasks. R5 notification delivery is a later phase.
