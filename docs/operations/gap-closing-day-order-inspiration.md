# Day ordering and Trips like this

Implemented October 21, 2026. Source implementation is separate from environment rollout
and physical-device acceptance. No production flag or provider configuration was changed.

## Day ordering

Overview → day details keeps the Move up/down controls, Optimize preview and checked Undo.
Web rows now have an HTML drag handle; native handles use React Native's responder API,
measured row centers and visible displacement. Other row controls remain independently usable.
No drag library or new runtime dependency is required. Keyboard/screen-reader users retain
the labeled 44-pixel Move controls. Browser touch users can use the same controls where
native HTML dragging is unavailable. Dragging reuses the existing authorized bulk order save.

Pin/Unpin persists `dayOrderPinned` on an activity. Pins constrain optimization, not deliberate
manual moves. Timed booked stops and stops without coordinates also keep their optimizer
slots. Moving an activity to a different date clears its saved position and pin. New clients
send both `pinnedIds` and `expectedPinnedIds` with drag, pin, Optimize and Undo saves. A stale
order or pin set returns 409 without writing. Older clients can still reorder without changing
pins. Account/trip/day changes fence pending UI callbacks and drag state.

Enable with the existing `planning_day_order` flag after environment/device acceptance.

## Activity inspiration and sharing

`planning_trip_inspiration` seeds off, fails closed on missing rows, supports the existing
admin cohort mechanism and is reported as `inspiration` in planning capabilities for members.
With it enabled:

- Overview → day details shows **Trips like this**, with up to six public blogs sharing a
  destination ID or the same normalized legacy destination text. No model or provider call
  is made. Public explore/SEO pages are still separate scope.
- Blog tools → **Share activity ideas** offers an explicit preview before opt-in. Sharing is
  off by default, independent of blog publication. A source must also have current public
  publication consent, a canonical public alias and discoverability (`indexingEnabled`) on.
  Making the blog private, revoking consent, disabling discoverability, deleting the source
  activity or stopping activity sharing removes its eligibility at the next request.
- Only activities with a currently eligible public catalog record are shared. The public
  template uses the **catalog's** name, category, coordinates and estimated duration, rather
  than a traveler's private edits. Manual activities and private coordinates are excluded.
  This includes current and future catalog-backed activities, as explained before consent.
- **Copy to [day]** creates a Proposed, zero-cost activity with empty booking/payment/traveler
  fields and source-blog credit in its notes. Source notes, costs, names of travelers, booking
  references, private addresses, media and EXIF are never read into the template or copied.
  Normalized names/durations remain estimates to check before booking.
- Copy uses `POST /api/activities`, an owner-scoped stable Idempotency-Key, and an atomic
  activity/feed/operation receipt. Permission, current source publication/sharing, catalog
  eligibility and destination date are rechecked in the adapter transaction before replay or
  creation. A new key cannot duplicate the same catalog idea on the same target day. Undo uses
  the existing conflict-safe activity undo: changed/shared/financially linked rows are refused.
- Shared results are `private, no-store`; the UI refreshes on foreground/resume, every 30 seconds
  while active and on request. Old account/trip/day responses cannot fill the current view.
  The server rechecks sharing at copy time even if the displayed recommendation became stale.
  Copies already made remain in their destination trip after source withdrawal; downloaded
  content cannot be recalled.

## API and bounded reads

- `GET /api/trips/:id/similar-trips` — authenticated writable target; `{ trips }` allowlist.
- `GET /api/trips/:id/activity-sharing` — traveler-only state and exact public-template preview.
- `PUT /api/trips/:id/activity-sharing` — traveler-only `{ enabled: boolean }`.
- `POST /api/activities` — `{ tripId, date, publicSource: { username, tripSlug, activityId } }`.
  Additional fields are rejected; a caller cannot submit copied data or override the allowlist.
- `PUT /api/activities/day-order` — adds optional paired `pinnedIds`/`expectedPinnedIds`.

The first discovery version considers at most 50 opted-in blogs and 100 source activities
per blog. Publication/destination checks precede catalog reads; results stop at six matches.
It is a bounded recommendation window, not an exhaustive search of every published trip.
All source/target checks and writes exist in Postgres and Firestore; memory reuses Postgres.
Existing equality indexes support the Firestore queries; no new composite index is required.

Apply `20261028_day_pins_and_activity_sharing.sql` before deploying on Postgres. Firestore uses
optional fields that default off/unpinned and requires no backfill. Roll back either surface
with its own flag while retaining the expanded schema. Sharing has no effect unless the source
is already public and discoverable; it does not publish a blog or change public location sharing.

## Validation

Focused suites: `activity-day-order`, `trip-inspiration`, `planning.adapter-parity`,
`planningP1Contracts`, `gapClosingFlags`, `dayActivitiesOrdering`, `dayRouteOptimizer`,
`tripsLikeThis`, `overview` and `tripBlogSharedMap`. They exercise membership, consent,
publication/opt-out withdrawal, safe projection, cross-destination exclusion, duplicate/replayed
copies, Undo, stale pins, gesture saves and stale account/trip responses.

A real Chromium check renders the actual components through React Native Web with simulated
API responses; it verifies HTML dragging and its expected-order request, pins, copies and
sharing preview. It is component/browser evidence, not an authenticated deployed app or
physical-device acceptance. Native responder tests do not establish real OS gesture behavior.

Final local results:

- Five focused frontend suites: 76 tests passed; the final ordering/inspiration rerun passed
  all 19 tests after the web checked-state accessibility fix.
- Five memory-adapter backend suites: 28 tests passed; the final two changed suites passed
  all 14 tests, including withdrawal before replay and date-change pin clearing.
- Real Firestore emulator (`demo-gap-inspiration`, localhost:8189): three suites / 20 tests
  passed (`trip-inspiration`, `activity-day-order`, `planning.adapter-parity`). The emulator
  used an isolated, checksum-verified JRE under `.artifacts`; no deployed project was touched.
- Frontend/backend TypeScript and diff checks passed. Production web export and Android/iOS
  Hermes exports passed; these exports are not compiled native builds or device execution.
- Chromium passed drag ordering, persisted pins, `aria-checked`, identifier-only copy requests
  and sharing preview/consent. Screenshot: `.artifacts/planning-preview/browser.png`.

Before enabling: apply the PostgreSQL migration where applicable, validate physical-device
drag/scroll/screen-reader behavior, and collect deployed permissions/publication/concurrency,
index and performance evidence for the intended environment. Real PostgreSQL contention and
an authenticated full-app browser journey were not exercised in this slice.
