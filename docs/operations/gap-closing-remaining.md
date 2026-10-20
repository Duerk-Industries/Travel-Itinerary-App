# Gap-closing completion audit

Source audit: 2026-10-19. P0/P1/P2 are **not all complete**. This record separates
implemented changes from outstanding source work and release evidence.

## Additional changes implemented

- Offline expense recovery: explicit sign-out choices with unsynced count;
  rejected-entry Edit, Export, Retry and Discard. Replacement is durable before
  the original is replaced, and uses a new operation key only for a definitively
  rejected entry. Ambiguous outcomes retain their original key. Export preserves
  that key so recovery can avoid duplicate creation.
- Queue safety: cryptographic native/browser operation IDs, serialized durable
  enqueues, account-generation fencing, captured replay credentials, stale native
  hydration fencing, and corrupt-queue preservation. An account switch stops the
  rest of a drain and cannot write its result into the next account's queue.
- Snapshot storage: five saved trips, conservative 20 MB serialized ceiling,
  oldest-saved eviction excluding the current save, oversized-save failure that
  preserves the previous copy. Financial queues are never evicted with snapshots.
- Notification quiet hours extend existing category preferences on both adapters.
  Inbox delivery remains immediate; push/email outbox work waits until the next
  real instant outside the window, without spending a retry attempt. Local IANA
  timezones account for DST gaps and repeated hours. Existing channel-only edits
  preserve quiet hours; explicit null disables them.
- Free adjacent-stop walking/driving estimates on web maps use straight-line
  distance and 5/30 km/h speeds, with barrier/traffic/accessibility limitations.
  Missing coordinates never create an estimated leg over an unresolved stop.
- Offline shell: boot assets are staged before replacing the cached entry page;
  failed updates retain the previous complete build. Cache eviction pins the
  current boot assets. A Chromium production-export smoke verified install,
  offline landing reload and a simulated online HTML update followed by offline
  reload. See `output/playwright/gap-shell-offline.png`.
- Automatic import controls: explanation, personal switch, recent additions,
  matching reasons and conflict-safe seven-day Undo in Imports. The history remains
  available when the global automation flag is switched off. Forwarded email is
  still suggestion-only; activation/quality gates are unchanged.

Apply `20261025_notification_quiet_hours.sql` before deploying the updated
PostgreSQL notification preferences. Firestore needs no schema migration for
these optional preference fields. Nothing in this task activates production flags,
provisions a provider, deletes stored artifacts or deploys a native build.

## Continuation: cohorts, scheduled digests and browser storage

Implemented in the continuation after P2.5:

- Admin → Feature Flags can manage explicit user cohorts for the six planning
  surfaces plus inbox, push and email. Cohorts require an owner, future UTC
  retirement date and audit reason; an empty list denies everyone. Expired or
  malformed rules deny access. Removing a rule widens eligibility only when the
  global flag is already enabled. The global cached flag is checked first;
  membership is evaluated per caller and never cached as a per-flag boolean.
  Capability and use-time checks receive the authenticated user. Rule refresh is
  at most 60 seconds across instances; the editing instance clears its cache.
- The existing category preferences now support a local daily-summary time and
  IANA timezone. Summary source windows stay UTC. Durable per-user work rechecks
  preference edits, membership and consent; parent retries and child delivery use
  the same dedupe identity. DST gaps use the first real minute after the chosen
  wall time, and repeated hours use the first occurrence. Quiet hours still defer
  push/email independently of inbox delivery.
- Browser snapshot copies use `offlineSnapshotStorage.web.ts`, an IndexedDB
  transaction adapter. Saves wait for transaction completion, not request success.
  Native storage remains the previous adapter pending the encrypted-store spike.
  The explicit Save this trip offline control warns about shared devices, reports
  progress/size/date, preserves prior copies on failure and fences account changes.
  Access is extended only after the server authorizes a complete download. Native
  automatic download behavior is unchanged; browser saves are deliberate.
- Discard waits for durable read-back. A storage failure keeps the expense and
  keeps the user signed in when discarding during logout. Unreadable queues expose
  an account-fenced recovery export; a JSON envelope preserves the original contents
  and operation keys without interpreting the corrupt contents. Corrupt originals
  are not silently removed or overwritten.

Apply `20261026_notification_digest_timing.sql` before the updated PostgreSQL
notification preference API; Firestore stores optional schedule fields on existing
preference documents. Cohorts use existing admin settings on both adapters and
need no new collection or migration. No global feature value is changed.

The admin cohort API is `GET|PUT /api/admin/features/:key/cohort`. PUT accepts
`{ cohort: { userIds, owner, retireAfter }, reason }`; `cohort: null` removes the
restriction. Retain an owner and retirement review for each temporary rollout.

Real Chromium checked the actual IndexedDB adapter bundled in isolation:
transaction abort retained the old value, another account key survived deletion,
and ten concurrent writes committed. Evidence: `output/playwright/idb-check.log`.
This does not establish a signed-in offline app flow or cross-tab financial queue
locking. Snapshot storage and pending financial queues remain distinct.

## Continuation: additional forwarding-address verification (§3.1)

`server/src/ingestion/shared/verifiedSenders.ts` plus `GET|POST /api/ingestion/forwarding/addresses`,
`POST .../addresses/confirm` and `DELETE .../addresses/:id`. A user adds up to five
extra addresses; an eight-character single-use code is emailed only to that address
(30-minute expiry, 60-second resend cooldown, five wrong guesses invalidate it, hourly
rate limits on start and confirm). Codes are stored only as hashes bound to the user
and address, and never returned, logged or listed. Both adapters are transactional
(user-row lock / Firestore transaction); account deletion removes the records.
Needs no manual migration on Postgres (table is created on first use, as for aliases);
Firestore collection `ingestion_verified_senders` is queried by `userId` only.

This grants **no** trust yet: forwarded mail is still suggestion-only. `isVerifiedSender`
exists for the matcher, but using it requires trusted receiver authentication fixtures
(below). The Imports UI for adding/confirming addresses is not built. Covered by
`server/__tests__/verifiedSenders.test.ts` (pg-mem only).

## Continuation: audience-safe blog day maps (§1.3, partial)

- Day facts now carry `mapPoints` (`blogMapProjection.ts`). Travelers get their own geotags
  (5 decimals, no timestamps or media ids). Anyone else gets points only when the trip's new
  `trip_blogs.shared_map_enabled` is on (default off, fail-closed on a missing row/doc;
  `PATCH /api/trips/:id/blog { sharedMapEnabled }`, any traveler). Those points are snapped to
  0.01° cells (~1.1 km), de-duplicated, capped at 12, dropped within 1.5 km of any lodging that
  has coordinates, and withheld entirely unless two distinct areas remain. The facts cache key
  includes the sharing choice, so turning it off applies on the next request.
- Followers no longer receive the legacy `dayMap` stored-image fact (rendered from exact
  geotags, never consent-gated). Travelers still do for old clients; retirement of the render
  job and `blog_day_map_artifacts` waits for those clients.
- Web blog day cards draw `mapPoints` with the existing `TripMap`; native shows no blog map.
- Apply `20261027_blog_shared_map_enabled.sql` before deploying (Firestore needs nothing).
- Limits: suppression only knows lodgings that already have coordinates, so a trip with
  un-geocoded lodging can still show a stop near where it stayed. Rounding is not
  anonymisation. This is why sharing is a deliberate opt-in. **Not built:** the settings
  control for `sharedMapEnabled` (and the existing `photoLocationEnabled`) in the app, the
  owner's preview of what followers will see, the public blog page map (that page exposes no
  coordinates today, and still must not), recap/keepsake maps, and legacy artifact retirement.
- Tests: `blogMapProjection.test.ts`, `blog-day-map-points.test.ts` (pg-mem; Firestore path
  not exercised) plus all 42 blog suites; no browser check of the rendered map.

## Continuation: replay locking without Web Locks (§5.3)

Audit finding: the financial (expense) queue on web already uses the IndexedDB lease in
`pendingWriteStore.web.ts` (claim, heartbeat renew, fencing token on every commit), which does
not depend on Web Locks. If IndexedDB is unavailable the queue fails visibly rather than running
unlocked. The only unlocked path was the legacy non-store branch of `usePendingWrites`, used
when `navigator.locks` is missing.

- `utils/replayLock.ts`: a localStorage claim-then-verify lease (30 s term, 10 s renew, 30 ms
  verify wait) now backs that branch. It narrows, but cannot eliminate, a double replay because
  localStorage has no compare-and-swap; every replayed write still carries an Idempotency-Key.
  Without any storage (native) it runs unlocked as before; storage that rejects writes also
  runs the work rather than stranding the queue.
- Both lease implementations now treat a lease further out than two terms as expired, so a
  clock moved backwards cannot block replay for hours.
- Tests: `replayLock.test.ts`; `usePendingWrites.test.tsx` now waits for the drain to start.
  The IndexedDB clock guard has no test: there is no IndexedDB fake in this repo, and the
  Chromium adapter check in `output/playwright/idb-check.log` predates it.
- Still open here: real two-tab browser run, native encrypted queue, bounded resume recovery and
  an automatic repair/import flow for corrupt queue exports.

## Continuation: app controls for shared blog maps and extra forwarding addresses

- **Follower day maps (§1.3).** In Blog tools (edit mode) a "Follower day maps" box shows On/Off.
  Turning it on requires first loading `GET /api/trips/:id/blog/map-sharing-preview`
  (travelers only, `private, no-store`), which runs the same projection followers get and lists
  the approximate areas per day; the confirm button is unavailable, and the handler refuses,
  when the preview is empty. "Stop sharing maps" applies on the next request.
  Covered by `tripBlogSharedMap.test.tsx` and the preview case in `blog-day-map-points.test.ts`.
- **Extra forwarding addresses (§3.1).** `ImportSenderAddresses` (inside Forward by Email) is
  collapsed by default and loads only when opened: send a code, enter it, list, remove. Copy
  says plainly that confirming does not yet change how forwarded bookings are handled.
  Covered by `ImportSenderAddresses.test.tsx`. Full app suite: 255 suites / 1,663 tests pass.
- Not done: the settings control for `photoLocationEnabled`, the automatic repair/import flow for
  corrupt expense-queue exports (financial data; it needs its own design and review), and
  everything listed under external evidence.

## Continuation: queue repair, photo locations and Firestore emulator runs

- **Corrupt expense-queue repair (§5.3).** The recovery screen now offers, after an export,
  *Repair saved expenses* and *Restore from a recovery file* (file chooser on web, paste
  everywhere). Repair keeps every entry that individually validates and that the app could replay
  (`isReplayablePendingExpense`), under its original id and operation key, so the server's
  Idempotency-Key still prevents duplicates. The unreadable original is backed up first and kept
  (IndexedDB row `<key>::corrupt-backup::<time>`, plus a localStorage copy of an unreadable legacy
  value; native uses `<key>.corrupt-backup.<time>`). If nothing is recoverable, nothing changes.
  Ids already synced or discarded (the store's tombstones) are not resurrected from an old file.
  A file from another account or server is refused. Logic: `utils/pendingQueueRepair.ts`,
  `repairQueue` in `usePendingWrites`, `repair` in `pendingWriteStore.web.ts`.
  Verified by `pendingQueueRepair`, `usePendingWritesRepair` and `PendingExpenseRepairFlow` tests,
  and in real Chromium against the actual IndexedDB adapter with
  `node scripts/check-pending-queue-repair.cjs` (interrupted repair leaves the original; keys,
  tombstones, both backups and a readable legacy copy all behave). Still untested: native
  devices, a real two-tab race during repair, and a usability pass on the wording.
- **Photo locations.** Blog tools has a "Keep photo locations" switch (off by default) that sets
  the existing `photoLocationEnabled`. Copy states it is not retroactive and does not remove
  saved locations. Covered by `tripBlogSharedMap.test.tsx`.
- **Firestore emulator runs.** Run with a throwaway project on its own ports, for example
  `firebase emulators:start --only firestore --project demo-x` using a config with port 8181, then
  `JEST_DB_PROVIDER=firebase FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 GCLOUD_PROJECT_ID=demo-x npx jest
  --config jest.projects.js --runInBand ...` (the bootstrap reads `JEST_DB_PROVIDER`, not
  `DB_PROVIDER`). **Passing on the real emulator:** expense idempotency and sync, expenses,
  day order, ingestion routes, pending queue, trip matcher, mailgun, data deletion, mail
  admission, verified senders, notification outbox delivery and timing, gap-closing flags, and two
  new provider-neutral suites: `planning.adapter-parity` (cohorts, idempotent Add and Undo, bundle
  304 and version change, day order, lodging coordinates, map proxy bounds) and
  `blog-day-map-points` (opt-in, coarsening, lodging suppression, immediate withdrawal, preview).
  **Cannot run on Firestore by design:** suites that call Postgres directly
  (`planningP1Contracts`, `planningNotificationWork`, `notification-service`,
  `ingestion.auto-assign`, `blog-day-facts`); the provider-neutral suites above cover their
  Firestore behaviour except notification inbox/work-queue internals and auto-assign
  assignment/undo, which still need a Firestore-native test. Emulator runs show behaviour, not
  contention, indexes or cost; those remain production-scale measurements.

## Continuation: Firestore parity (everything that runs on Postgres runs on Firestore)

Goal: the deployment only has Firestore, so every gap-closing behaviour has to be proven there.

**Run it:** start an emulator (`firebase emulators:start --only firestore`), then
`npm --prefix server run test:firestore -- __tests__/<suite>.test.ts ...` (set
`FIRESTORE_EMULATOR_HOST` if it is not on 127.0.0.1:8080). Data goes under a throwaway project id
(`demo-server-tests`), not your dev project. Without file arguments it runs the whole server suite,
which takes a long time.

**Real defects found by running on Firestore, and fixed:**
- `GET /api/notifications/devices` returned the raw device document, including the encrypted push
  token and its hash. It now returns the same scrubbed columns as Postgres.
- `DELETE /api/notifications/devices/:id` did not check ownership on Firestore (any signed-in user
  who knew an id could disable another person's device). It now only acts on the caller's own.
- Day media lookups on Firestore (`getVisibleMediaForDay`, `countAllReadyMediaForDay`,
  `hasTextItemForDay`) filtered by calendar date only, so a trip's day facts could include another
  trip's photos from the same date, and with shared maps their locations. They are now scoped to
  the trip, like the Postgres queries. Regression test: "never mixes in another trip's photos".
- `scheduledJobLease` was Postgres-only; it now works on Firestore (`create()` on a deterministic id).

- **Sign-in with a missing profile field failed on Firestore.** Google (new or returning user) and
  Apple sign-in wrote `undefined` for fields like `picture` or `firstName`, which Firestore rejects.
  Firestore is now created with `ignoreUndefinedProperties`, so a missing value is stored as absent,
  as Postgres stores NULL.
- **Trip wizard never invited a named traveler who had an email.** On Firestore a name took
  precedence over an email, so the person became a guest and no invite was created (Postgres
  invites them and keeps the name as a label). Fixed; this also fixed `packing-list`.
- **Editing an itinerary item failed on Firestore** with "Itinerary detail not found": the
  adapter's `updateItineraryDetail` had its `(userId, detailId)` arguments in the opposite order
  to the shared interface. Fixed.
- **Blog items edited after syncing from the itinerary were not marked detached** on Firestore
  (the link was, the item field the API reads was not). Fixed.
- **Stripe webhook attempt counts** started at 0 on Firestore and 1 on Postgres; now both 1.

**Converted to run on both adapters** (raw SQL fixtures replaced by provider-aware helpers in
`__tests__/providerRows.ts`): `ingestion.auto-assign` (add, Undo, edited/paid/expired refusals),
`planningP1Contracts` (cohorts, digest scheduling, idempotent Add, bundle 304 and invalidation by
direct writes, lodging coordinates), `planningNotificationWork`, `notification-service`,
`blog-day-facts`, `blog-day-map-points`. New: `planning.adapter-parity`, `scheduledJobLease`.
Together with the earlier suites (expenses, idempotency, day order, ingestion, mail admission,
verified senders, notification delivery and timing, flags) all 25 listed suites pass on both pg-mem
and the Firestore emulator.

**Full-suite Firestore run (358 suites): 326 passed before these fixes.** The 31 failures were 20
suites with raw-SQL fixtures plus 11 others; of those 11, six were the defects above. Left as-is
and not caused by this work: `firestore.rules` (needs the rules emulator, which my throwaway one
did not load), `aiAssistantActionsEntitlement` (expects a flag with no stored row, but Firestore
startup seeds flag rows), `ai/captureNeverBlocks` (mocked pipeline takes a different path under
Firestore's seeded flags), `packing-list-v2` (three tests are raw-SQL migration tests; one shows
packing groups in a different order on Firestore, "Clothing & Footwear" first rather than "Health &
Toiletries", which is a product decision), and `blog-account-deletion-scrub` (fixed email collides
across runs). Re-run the full suite on your own emulator before relying on this list.

**The 16 older blog suites now run on both adapters.** They were converted from raw SQL fixtures to
the shared helpers in `__tests__/providerRows.ts` (members, followers, publication state, engagement
rows, recap seeds), or to API-driven setup (`public-blog`). `blog-counter-reconciliation` keeps its
drift tests Postgres-only by design (the job repairs Postgres JSONB counters and skips Firestore) and
asserts on Firestore that counters are exact and the job is a no-op. Test isolation: every test file
on Firestore now starts from an empty emulator database (the hook in `jest-after-env.ts` clears
`FIRESTORE_DATABASE_ID`, falling back to `(default)`, only for a `demo-`/`jest-` project on an
emulator), matching pg-mem's fresh database per file. Earlier Firestore runs in this document
accumulated state because the tests use the named database from `server/.env`, not `(default)`.

**More Firestore-only defects found while converting them, and fixed:**
- Per-emoji reaction counts were written under a literal dotted field name, so the summary always
  showed `{}`; a reactor list also looked up the wrong field and always came back empty.
- Removed reactions left `emoji: 0` entries in the summary.
- A day's comment list only included comments placed directly on the day, not those on its entries
  or photos (Postgres includes all three).
- Blog contributors scanned every trip's items and photos in the database and matched by date, so
  another trip's uploader names could appear (and the read cost grew with total data). Now per trip.
- Deleting an account tombstoned the author's comments but kept the author's user id on them;
  Postgres clears it through a foreign key. Now cleared.

**Firestore security rules.** `firestore.rules.test.ts` needs the Firestore and Auth emulators and the
rules loaded. `npm --prefix server run test:firestore-rules` loads `firestore.rules` into the running
emulator (REST `PUT /emulator/v1/projects/<id>:securityRules`) for a throwaway project id
(`demo-rules-test`) and runs the test there, so your dev project's data and rules are untouched. Result
on the running emulator (127.0.0.1:8080, Auth 9099): 13 of 13 pass. It failed earlier only because the
throwaway emulator I used had no rules loaded.

**Composite indexes (production only).** The emulator does not enforce them; production Firestore
fails a query that combines an equality filter with a range or ordering on another field unless an
index exists. Three were missing and are now in `firestore.indexes.json`: `notification_work`
(`completed`, `expiresAt`, used by cleanup) and, from older blog workers, `blog_media_assets`
(`state`, `createdAt` desc) and `blog_items` (`tripId`, `createdAt`). `firestoreIndexes.test.ts` fails
if any of the 12 indexes the gap-closing and blog worker queries rely on is removed. **Deploy them**
(`scripts/deploy-firestore-indexes`) before enabling the notification cleanup or the day-photo
reminder; until they finish building those queries error in production.

**Known, unchanged (same on both adapters):** two trips whose owner and trip name slug to the same
words share one public address, because aliases are unique on (username slug, trip slug) and are
reused rather than suffixed.

## Source work still outstanding

| Plan area | Actual remaining implementation |
| --- | --- |
| §1.3 public/blog/recap maps and keepsake | Server projection, consent flag and web blog-day rendering are built (see above). Remaining: public page/recap integration, bounded export-only keepsake capture, and legacy-artifact retirement after reader migration. Do not publish EXIF or private lodging coordinates. |
| §1.4 optional geocoder | Provider/input policy decision, shared admission/throttling, durable jobs/cache and adapter fencing. This is optional; current catalog/airport maps need no geocoder. No private query or bulk Nominatim backfill is authorized. |
| §1.5 native renderer | Expo/RN compatibility and named-device spike before adding the native renderer, independent rollback flag, staged EAS build and supported-old-client retirement. Current authorized static-map/list fallback stays supported. |
| §3.1 / §3.2 sender trust | Trusted receiver alignment and validated Gmail confirmation recognition. Actual receiver fixtures are required; claimed From/authentication headers remain insufficient. |
| §4.1 / §4.2 rollout and timing | Cohort controls and configurable digest timing are implemented. Live cohort/provider delivery, other timezone/device coverage and cost/latency evidence remain release gates. |
| §5.2 native/browser stores | Transactional encrypted native store and device-backed key lifecycle, authenticated migration/reinstall/key-loss recovery. Browser IndexedDB and shared-device save controls are now implemented. Native AsyncStorage and the financial queue remain unencrypted. |
| §5.3 queue concurrency and recovery | Two-tab browser verification is done (`node scripts/check-queue-locks.cjs`: the IndexedDB lease is exclusive across two real tabs, hands over on release, refuses writes without the lease and ignores a clock-skewed lease; the localStorage fallback lock double-ran 0 of 40 simultaneous races, which can still happen rarely because localStorage has no compare-and-swap). Still open: encrypted native queue retention; native/device replay lifecycle evidence (bounded replay and automated resume/recovery checks are implemented; see the 2026-10-20 continuation below). The corrupt-queue repair/import flow is built (see above). Durable discard feedback and raw whole-queue recovery export are now implemented. |
| §5.4 browser shell | Local Chromium install/offline reload and simulated HTML update checked. `firebase.json` hosting headers reviewed: `/sw.js` is `no-cache` with `Service-Worker-Allowed: /`, `/index.html` is `no-store`, the catch-all adds only the CSP (which already allows the tile host and blob workers). Still needs a real deployment check of hash-change recovery, signed-in offline flows and other browsers. Browser push and public explore remain later scope in §7. |

Snapshot eviction is oldest-saved, not a claim of access-based LRU. Queue storage
keys intentionally retain the existing environment-qualified format rather than
silently orphaning existing financial work under a new hash.

## External evidence still required

- Production flag/settings and map object inventory; reviewed provider-storage
  rights; actual provider/scanner readiness, receiver forwarding trials, scheduler
  configuration and multi-instance recovery.
- Real PostgreSQL concurrency/trigger migration, and Firestore index build status,
  contention and bounded cost measurements in production (emulator parity is done; see above).
- Named iOS/Android devices and EAS builds for storage/key loss, file sharing,
  maps, push receipts, memory and accessibility.
- Representative audited automatic-assignment fixtures and precision threshold;
  parser model quality/cost comparisons before consensus-rate changes.
- Novice task/recovery trials, screen-reader checks and measured latency targets.

These are release gates, not claims established by Jest, JavaScript export or
source inspection. The two earlier operation records remain historical records
of their respective slices; this audit takes precedence for completion status.


## Local verification for these additional changes

- Full frontend run: 247 suites / 1,610 tests passed; the worker suite hit an
  intermediate test TypeScript error while being edited during that run. Its
  final focused rerun passed 30 tests. Combined latest results: 248 passing suites,
  1,640 passing tests. No remaining known test failure.
- Backend: six focused suites passed 44 tests, followed by the final outbox suite
  passing seven tests after its new quiet-hour case (45 distinct passing tests
  across those six suites). The entire backend suite was not rerun for this slice.
- Workspace typechecks and production web export passed. The worker file was
  updated after export and copied into the generated build for the browser check;
  ordinary exports copy that same `app/public/sw.js` file.
- The local browser had no backend on port 4000. Its auth-feature connection error
  and offline resource errors are expected; this does not verify authenticated
  planning, provider tiles, production CSP or native device behavior.


### Continuation verification

- Frontend: 11 focused suites / 70 tests passed, covering cohort editing, digest
  preference UI, browser save confirmation/failure/account races, queue discard
  and corrupt export, startup, expenses and existing admin tier behavior.
- Backend: six final focused suites / 126 tests passed (admin, planning contracts,
  preferences/outbox, durable work and timing). The final DST/digest integration
  rerun passed 11 tests after extending the bounded recovery horizon to cover
  next-day fall-back delivery. Additional day-order, assignment, migration and
  billing entitlement checks passed during this continuation.
- Workspace typechecks passed; production web export passed. Actual IndexedDB
  abort/isolation/concurrent-write checks passed in local Chromium. No native,
  real-provider or production deployment validation is claimed.


### Bounded expense replay continuation — 2026-10-20

- Due entries are filtered before selecting the oldest 20 operations, so a batch of delayed retries cannot starve later ready expenses.
- Legacy/native replay now shares the transactional path's 20-entry and 45-second request-start bounds. Transactional replay checks elapsed time again after awaiting storage, before starting HTTP. An in-flight expense request retains its existing 15-second timeout; the drain budget does not cancel an already-started request.
- Automated coverage exercises a second bounded drain, backoff starvation, foreground resume with the original operation key and listener cleanup, account fencing, interrupted per-entry commits, lease replacement, concurrent discard, authentication pause and retained permanent rejection.
- Encrypted native storage and actual native suspend/kill/relaunch/key-loss evidence remain open; this completes the bounded replay implementation and automated lifecycle slice only.

Validation: four focused frontend suites / 56 tests passed; frontend TypeScript check and `git diff --check` passed. The full frontend/backend suites were not rerun for this slice.
