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

## Source work still outstanding

| Plan area | Actual remaining implementation |
| --- | --- |
| §1.3 public/blog/recap maps and keepsake | Server projection, consent flag and web blog-day rendering are built (see above). Remaining: settings control and owner preview of the approximate map, public page/recap integration, bounded export-only keepsake capture, and legacy-artifact retirement after reader migration. Do not publish EXIF or private lodging coordinates. |
| §1.4 optional geocoder | Provider/input policy decision, shared admission/throttling, durable jobs/cache and adapter fencing. This is optional; current catalog/airport maps need no geocoder. No private query or bulk Nominatim backfill is authorized. |
| §1.5 native renderer | Expo/RN compatibility and named-device spike before adding the native renderer, independent rollback flag, staged EAS build and supported-old-client retirement. Current authorized static-map/list fallback stays supported. |
| §3.1 / §3.2 sender trust | Imports UI for the (now built) address verification API, trusted receiver alignment and validated Gmail confirmation recognition. Actual receiver fixtures are required; claimed From/authentication headers remain insufficient. |
| §4.1 / §4.2 rollout and timing | Cohort controls and configurable digest timing are implemented. Live cohort/provider delivery, other timezone/device coverage and cost/latency evidence remain release gates. |
| §5.2 native/browser stores | Transactional encrypted native store and device-backed key lifecycle, authenticated migration/reinstall/key-loss recovery. Browser IndexedDB and shared-device save controls are now implemented. Native AsyncStorage and the financial queue remain unencrypted. |
| §5.3 queue concurrency and recovery | Real two-tab browser verification of the lease fallbacks; encrypted native queue retention; bounded replay/resume recovery and lifecycle testing; a supported automatic repair/import flow for corrupt queue exports. Durable discard feedback and raw whole-queue recovery export are now implemented. |
| §5.4 browser shell | Local Chromium install/offline reload and simulated HTML update checked. Real deployment/hash-change recovery, hosting headers, signed-in offline flows and other browsers still need verification. Browser push and public explore remain later scope in §7. |

Snapshot eviction is oldest-saved, not a claim of access-based LRU. Queue storage
keys intentionally retain the existing environment-qualified format rather than
silently orphaning existing financial work under a new hash.

## External evidence still required

- Production flag/settings and map object inventory; reviewed provider-storage
  rights; actual provider/scanner readiness, receiver forwarding trials, scheduler
  configuration and multi-instance recovery.
- Real PostgreSQL concurrency/trigger migration and Firestore emulator parity,
  indexes, contention and bounded cost measurements.
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
