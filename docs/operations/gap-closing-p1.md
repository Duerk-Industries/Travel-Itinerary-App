# Gap-closing P1 implementation and rollout

Source implementation: 2026-10-19. This is not a production activation record.
P1 means the three P1 delivery slices in §7 of the gap-closing plan. Reorder,
optimization, external geocoding, automatic assignment, native MapLibre,
public/blog map projections, encrypted-store migration and offline expense
replay are P2 scope and are outside this P1 record.

## Delivered behavior

- Imports: private alias Copy, local QR, vCard, deliberate rotation, Gmail /
  Outlook / Apple Mail instructions and authenticated synthetic receipt test.
  The synthetic test exercises alias/receipt persistence; it does **not** prove
  an email provider's forwarding rule or send mail. It never parses a booking,
  reserves import allowance or sends a reply. Native file picker accepts ICS;
  the existing native share sheet offers PDF/screenshot import through the same
  upload/scanning route, separately from blog publication.
- Structured extraction: bounded ICS events and schema.org JSON-LD/microdata,
  before the existing extractor stack. Unstripped scanned HTML accompanies
  plain text. Malformed structured input goes to review; scripts, remote
  contexts, calendar recurrence and remote attachments are never executed or
  expanded. Exact-document cache includes owner, parser/schema and model policy.
  Transfers Paste Info now calls the same extraction stack. Suggestions use
  writable trips, date overlap and destination evidence; origins do not count.
  Ambiguous/timezone-unknown items require a trip choice. No automatic writes.
- Web maps: lazy MapLibre/OpenFreeMap, linked accessible stop list, missing-point
  labels, responsive split view, visible attribution, failure fallback and
  offscreen disposal. Airport/catalog coordinates are reused. Other coordinates
  are nullable; editing an address clears stale coordinates. No new geocoder.
  Native static-image requests require an authorized stored trip/day or lodging,
  with fixed geometry, rate/budget limits, timeout, MIME/byte bounds and no-store.
- Nearby: approved public catalog projection, at most 2,000 indexed entries per
  destination, 12 destinations, five-minute cache, 2 km radius, at most 20 cards
  per page. Trait/popularity/distance ranking is deterministic and uses no LLM.
  Add uses the existing activities route and owner-scoped operation receipt.
  Activity, receipt and activity feed commit together. Undo refuses edited rows,
  votes or linked financial changes. Partner CTAs use the existing GYG gate.
- Inbox: authenticated personal socket rooms, bounded compound cursors, unread /
  read-all, reconnect/resume catch-up, independent channel preferences and
  server-authorized targets. Push carries generic text and notification ID only.
  Registration asks permission only when the user enables mobile alerts.
  Notification and outbox intent commit atomically on both adapters; email-only
  rows stay out of the inbox. Each consented channel owns its outbox row; push
  failure never creates or duplicates email delivery.
- Scheduler: durable scan cursors, deadlines, UTC daily digests and delayed Expo
  receipts; expiring leases and completion fencing on both adapters. Completed
  imports / durable generation results are reconciled to deduplicated inbox
  events, so a producer crash can recover. Deadline edits/deletion/cancellation
  invalidate queued work at delivery. Date-only deadlines mean 00:00 UTC; zoned
  values retain their instant. Digests use fixed UTC days, at most 100 feed events
  per trip/day, and are off by default. Quiet hours were subsequently implemented; see `gap-closing-remaining.md`.
  Provider delivery is at-least-once: a crash after provider acceptance can still
  duplicate an external message; do not claim exactly-once push/SMTP delivery.
- Bundles: private member-only typed v1 bundle, permission/schema/owner-sensitive
  ETag, access before 304, cheap revisions before child reads, bounded inventory
  and five-MiB response cap. PostgreSQL uses a repeatable-read transaction;
  Firestore fences the graph with atomic writer revisions and retries once.
  The native downloader persists the ETag with a complete owner-scoped snapshot;
  partial/failed refresh keeps the prior copy. Disabled bundles use old fetches.

## Mutation inventory and deployment order

| Bundle input | Version sources / writers |
| --- | --- |
| Trip, dates, destination, notes, currency, covering | `trips` CRUD, wizard, ingestion and itinerary saves |
| Transfers, lodging, activities, rentals | `flights`, `lodgings`, `tours`, `car_rentals`; routes, CSV, ingestion assignment/undo, generation |
| Expenses / payments | `expenses`, `trip_payments`; item-generated expenses, manual ledger writes and ingestion reconciliation |
| Plan / checklist | `itineraries`, `itinerary_details`, `itinerary_checklist_items`; generation, note, order and checkbox edits |
| Member projection | `groups`, `group_members`, `group_invites`, `users`, `web_users`; invite, removal, profile/name/email/airport and deletion |
| Cost access | Evaluated before ETag on every request; included in the representation key |

PostgreSQL revision triggers cover SQL outside `db.ts`, including ingestion.
Firestore's SDK write boundary covers refs, snapshot refs, batches and
transactions in the adapter and ingestion repository. Scope bumps share commit
with domain writes. Profile changes conservatively invalidate all profile
projections as well as known groups. pg-mem uses a conservative whole-database
statement counter; it cannot prove production transaction concurrency.

1. Apply `20261020`–`20261023` expansion migrations on PostgreSQL. The trigger
   migration is deliberately skipped only for pg-mem. Do not copy that skip to
   production. Retain revision scopes across restarts/deletions.
2. Deploy all writers with `TRIP_BUNDLE_VERSIONING=1`, keeping `trip_bundle` off
   until **every** writer uses the new SDK boundary/triggers. Old writers make
   conditional responses unsafe. For rollback, disable `trip_bundle` first.
3. Deploy `firestore.indexes.json`; wait for indexes to finish. On Firestore,
   backfill legacy notification `inApp` fields with the bounded, resumable
   `server/scripts/backfill-planning-notifications.ts` (dry run first; `--apply`
   performs updates). Keep inbox rollout off until this is complete. Configure
   TTL for completed `notification_work.expiresAt` if desired; the worker also
   prunes bounded expired work. Operation receipts retain 30 days of retry/Undo
   history. Do not promise replay after that retention window.
4. All five new flags seed off and fail closed: `planning_web_map`,
   `planning_nearby`, `planning_structured_import`, `planning_notifications`,
   `trip_bundle`. Owner: planning. Roll back each by switching its flag off;
   lists, upload/review, saved copies and ordinary screen fetches remain.
5. Provision scheduled calls separately (not done here): POST
   `/api/internal/ingestion/notifications/run`, with existing
   `X-Ingestion-Worker-Secret`, synchronously awaited. Start at once per minute;
   measure scan-cycle age before increasing cohort size. Each run claims at most
   50 planning jobs, scans 25 records per source page, and drains 10 outbox rows.
   Alert on non-2xx responses and growing oldest-due age. A resident interval is
   optional and is not the Cloud Run reliability mechanism.
6. Hosting CSP includes only `https://tiles.openfreemap.org` for tile/style/font
   fetches and the existing same-origin/blob worker permission. No CDN script
   fallback or new provider signup. New native PDF share declarations require a
   new EAS build. Publish a minimum native version before enforcing the new
   server-owned map context; legacy arbitrary-point/address requests are rejected.

## Validation and remaining release gates

Automated evidence is recorded in the task's final test report. Web production
export and iOS JavaScript export have passed. MapLibre and QR are separate lazy
chunks. Browser landing smoke passed; the local auth-features API was deliberately
absent, so its connection failure is not a map/WebGL validation. No claim of an
authenticated map, real device, provider delivery or production deployment test.

Pinned runtime dependencies: MapLibre GL 6.15.0 (BSD-3-Clause), node-ical 0.26.1
(Apache-2.0), htmlparser2 10.0.0 (MIT), qrcode-generator 2.0.4 (MIT). MapLibre was
updated after the dependency audit identified the older sanitizer advisory.
Existing unrelated audit findings are not silently upgraded in this change.

Before enabling: real Postgres concurrent retry/revocation and trigger migration;
Firestore emulator parity and transaction contention; screen-reader/keyboard,
tile/WebGL loss and offscreen lifecycle; real iOS/Android file/share/push receipt
tests; measured cold/warm Nearby, bundle reads, scan-cycle cost and ingestion
quality against the plan's representative fixtures and user-task targets.

**Gmail confirmation recognition remains unavailable pending validated receiver
fixtures and trusted receiver identity.** Current forwarded mail is unverified /
suggestion-only. A From header is never enough to show a trusted confirmation
code, auto-follow a link or approve a forwarding rule. This release provides the
manual provider walkthrough; no code-recognition activation is implied. Keep
automatic assignment off until P2's quality and recovery gates are met.


## Final local test verification (2026-10-19)

- Frontend: full Jest run, 245 suites / 1,626 tests passed.
- Backend: full Jest run completed; the two migration suites that failed during
  that run passed after correction with `--runInBand --onlyFailures` (9 tests).
  Combined latest results: 352 passing suites, 2,237 passing tests, 44 existing
  skipped tests (one skipped suite). No remaining failing tests.
- `npm run typecheck` passed across app, server, messaging, domain and analytics;
  the final server typecheck passed after the parser/error and SQL fixes.
- `git diff --check` passed. Native EAS/device and real Postgres/Firestore
  validation remain separate release evidence, not inferred from these mocks.
