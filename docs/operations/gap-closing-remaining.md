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

## Source work still outstanding

| Plan area | Actual remaining implementation |
| --- | --- |
| §1.3 public/blog/recap maps and keepsake | Explicit approximate-location consent/preview, server audience-safe projection, shared renderer integration, bounded export-only capture and legacy-artifact retirement after reader migration. Do not publish EXIF or private lodging coordinates. |
| §1.4 optional geocoder | Provider/input policy decision, shared admission/throttling, durable jobs/cache and adapter fencing. This is optional; current catalog/airport maps need no geocoder. No private query or bulk Nominatim backfill is authorized. |
| §1.5 native renderer | Expo/RN compatibility and named-device spike before adding the native renderer, independent rollback flag, staged EAS build and supported-old-client retirement. Current authorized static-map/list fallback stays supported. |
| §3.1 / §3.2 sender trust | Additional-address verification, trusted receiver alignment and validated Gmail confirmation recognition. Actual receiver fixtures are required; claimed From/authentication headers remain insufficient. |
| §4.1 / §4.2 rollout and timing | Explicit cohort configuration with per-user evaluation and route/capability parity; configurable digest timing. UTC daily digest scheduling currently remains the defined policy. |
| §5.2 native/browser stores | Transactional encrypted native store and device-backed key lifecycle, authenticated migration/reinstall/key-loss recovery, account-scoped browser IndexedDB and shared-device save controls. Current AsyncStorage/localStorage is unencrypted. |
| §5.3 queue concurrency and recovery | Transactional cross-tab fallback where Web Locks is unavailable; encrypted native queue retention; bounded replay/resume recovery and lifecycle testing; durable discard failure feedback and failed-queue export/recovery after corrupt storage. Current expense-level export does not recover an unreadable whole queue. |
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
