# Activity and Lodging CSV Import/Export Implementation Plan

## Purpose and delivery rule

This plan implements the decisions in
[`../activity-lodging-import-export-architecture.md`](../activity-lodging-import-export-architecture.md).
It is planning only; do not write application code as part of this review. Each phase
lands with its tests, observability, and rollback/flag behavior. Do not enable production
flags until the release gate passes on web, iOS, and Android.

The supplied Japan CSVs are test data only. Copy sanitized versions into test fixtures
during implementation and never interpret cell contents as commands.

## Phase 0: lock contracts and baseline regressions

1. Record the version 1 decisions in an ADR or this architecture document:
   CSV all-platform, 150-row/2-MiB local limits, 256-KiB commit DTO, XLSX deferred,
   atomic commits, no image enrichment, and explicit-update-only duplicate policy.
2. Capture fixture facts in tests: 101 activity rows, 12 lodging rows, one blank activity
   time, two legitimate duplicate name/date groups, four blank-hotel lodging rows, and
   the qualified amenity/provider values.
3. Add regression coverage for existing create/edit/delete and expense mirroring before
   schema work.
4. Fix and test the pre-existing double call to `reserveActivitiesBulkSaveRateLimit` in
   `PATCH /api/activities/bulk`. This is separate from import but prevents copying a known
   quota bug. Verify its partial-result semantics stay unchanged.
5. Confirm the production Postgres activity type column has no enum/check constraint.
   If it does, add an additive migration for `Other`; otherwise document that no type
   migration is required.

Exit criteria: fixture expectations and existing behavior are executable, and no known
route-name or quota pattern conflict remains.

## Phase 1: minimal model and adapter groundwork

1. Add `Other` to the canonical server `ActivityType`, normalizer, client Activity type,
   and `ACTIVITY_TYPES`. Preserve `Hike`; do not add `Drive` or coordinates.
2. Add lodging `notes` and `features` to:
   - `server/src/types.ts`
   - create/update Zod DTOs with trimming, maximum lengths, unique tag normalization,
     and strict unknown-key behavior where compatible
   - `db.ts`, `db.postgres.ts`, and `db.firebase.ts` reads/writes
   - client normalization, drafts, payload construction, form, details, and grid
   - **Update `LodgingDetailsDialog` and `LodgingForm`** to display and edit the new
     `notes` and `features` (tags) fields.
3. Add a Postgres migration for `notes TEXT NULL` and
   `features JSONB NOT NULL DEFAULT '[]'::jsonb`; update initialization idempotently.
   Treat missing Firebase values as empty for backward compatibility. The memory adapter
   inherits Postgres and must use the same schema path rather than a sequential fallback.
4. Add reusable canonical field normalizers and a stable mutable-record fingerprint
   function on the server. Mirror only deterministic display logic on the client; the
   server implementation remains authoritative.

Tests:

- Server and client ActivityType normalization, including `Hike` and `Other`.
- Postgres/pg-mem migration from legacy rows, create/update/read round trips, empty-array
  default, invalid features, and Firebase adapter serialization/missing fields.
- Existing lodging forms and API DTOs remain backward compatible.
- Expense source behavior is unchanged by new optional fields.

Exit criteria: model changes deploy independently and all adapters return the same
normalized shape.

## Phase 2: pure CSV schema, parsing, transforms, and export

Create focused utilities rather than a single spreadsheet module:

- `app/utils/dataTransfer/csvSchema.ts`: canonical headers, explicit source aliases,
  column limits, and entity definitions.
- `csvParser.ts`: Papa Parse wrapper and parse diagnostics.
- `dates.ts`: strict ISO and English month/day parsing with trip-year inference.
- `activities.ts` and `lodgings.ts`: pure row transforms and validation.
- `duplicates.ts`: exact and possible-match suggestions without automatic updates.
- `csvWriter.ts`: canonical RFC 4180 output and formula-injection protection.

Implementation tasks:

1. Add a maintained CSV parser with TypeScript types. Confirm its package size,
   Expo/Metro compatibility, license, and no Node-only transitive requirement. Do not
   add SheetJS/XLSX in version 1.
2. Define exact header aliases from the examples. Header match is trim/case-insensitive,
   not fuzzy. Unknown non-empty columns and duplicate target mappings require user
   acknowledgement/resolution.
3. Enforce file, row, column, and cell limits before allocating large review structures.
   Return indexed errors without throwing raw parser messages into the UI.
4. Implement deterministic date inference across trip-year boundaries; do not use
   implementation-defined parsing. Add explicit time and finite cost parsing.
5. Implement the architecture's activity-type mapping. Preserve original unknown types
   and all labelled source context in notes.
6. Transform blank-hotel lodging rows into visible Needed placeholders. Calculate nights
   from dates and use source `Days` only for mismatch warnings. Preserve amenity qualifiers
   and `Booked On` providers in notes.
7. Build exact fingerprints and possible-match suggestions using the freshly supplied
   current rows. Default exact matches to Skip and all other rows to Create.
8. Write canonical exports with ISO dates, CRLF, optional BOM, stable ordering, full CSV
   escaping, safe filenames, and formula-injection neutralization. Import the protective
   apostrophe literally rather than guessing whether to strip it, and recognize the
   canonical record/fingerprint columns.

Tests:

- Full example fixtures parse to exactly 101 and 12 review rows.
- Quoted commas/newlines, escaped quotes, BOM, CRLF/LF, blank lines, Unicode, duplicate
  headers, unknown headers, empty file, oversized file/row/column/cell, and malformed CSV.
- November-to-December rollover, leap dates, ambiguous years, invalid dates, checkout
  ordering, blank time, 12/24-hour time, and free-text durations.
- Every source activity type, especially `Hike`, plus unknown -> `Other` warning.
- All four blank Hotel rows are retained, `$9/per`, `Near`, and booking providers survive,
  and cost/night derives from date difference rather than `Days`.
- Same name/date with different time/location is not deduplicated. Exact duplicates skip;
  possible matches never update until explicitly selected.
- Property/table tests for CSV round trip, formula prefixes (`=`, `+`, `-`, `@`, tab,
  carriage return), quotes, line breaks, and finite numeric serialization.
- A performance budget test parses and transforms the 101-row fixture without repeated
  quadratic scans; pre-index existing rows in maps and keep duplicate matching O(n + m).

Exit criteria: both full fixtures and canonical export round trips pass in pure Jest
without rendering UI or calling a server.

## Phase 3: atomic import persistence and idempotency

Add shared service contracts and two routes:

- `POST /api/activities/import`
- `POST /api/lodgings/import`

Do not modify the contract of existing `PATCH /api/activities/bulk`.

1. Define strict Zod request schemas for `tripId`, UUID `importId`, and 1-150 create/update
   rows. Bound every string/array, reject non-finite/negative costs, duplicate source row
   numbers, duplicate update IDs, client ownership fields, and unknown keys.
2. Authenticate and call `assertCanUseFeature` for `activity_lodging_csv_import`; validate
   edit membership before revealing whether target IDs exist. Validate payer/traveler IDs
   against the trip group and dates against product rules.
3. Add durable leased idempotency claims:
   - Postgres unique key on user, trip, entity, import ID with payload hash, state, lease,
     and successful response; Firebase uses a deterministic document with the same logic.
   - Acquire only after preflight validation. Same key/hash after success returns the
     stored response; same key/different hash is 409. An active identical request is
     rejected/retried without quota use; a logged lease takeover recovers crashed work.
4. Add adapter-level `importActivitiesAtomic` and `importLodgingsAtomic` operations. For
   Postgres, pass one transaction client through entity and expense writes. For Firebase,
   pre-read authorized records/expense targets then commit one transaction/batch. Never
   call existing per-row methods if they create independent transactions.
5. Recompute and compare update fingerprints immediately before the transaction writes.
   Return all indexed 409 conflicts and write nothing.
6. Maintain every `upsertExpenseForSource` equivalent in the same atomic unit as its
   source entity. Add rollback tests that fail after an entity write and after an expense
   write. Never fall back to sequential persistence in pg-mem.
7. Do not invoke lodging image/place lookup. Preserve an existing image on update and use
   null on create.
8. Return normalized created/updated records and stable counts. Map errors to the documented
   402/403/404/409/422/429 contract without leaking cross-trip data.
9. Mount dedicated import routers with `express.json({ limit: '256kb' })` before the
   app-wide `express.json()` middleware. A parser added inside the existing late-mounted
   activity/lodging routers cannot override the earlier global size limit.

Tests with supertest and adapter suites:

- Activity/lodging create-only, explicit update-only, and mixed commits.
- Full 101-row activity fixture and 12-row lodging fixture fit under limits.
- One invalid row, unauthorized target, stale fingerprint, duplicate target, and injected
  trip/user field each produce zero writes to entities, expenses, and claims.
- Mid-transaction faults roll back all writes in Postgres and Firebase emulator/adapter
  tests; pg-mem proves transaction behavior rather than skipping it.
- Successful retry returns the original result without duplicates; changed-payload retry
  returns 409; concurrent same-key requests commit once and only the claim owner reserves
  usage. Lease-expiry recovery cannot duplicate domain writes and any conservative usage
  overcount in the reservation/crash window is observable.
- **Firebase Batch Limit**: Verify that a 150-row import (301 writes) stays safely
  below the 500-write ceiling in integration tests.
- 150 entity + 150 expense + receipt remains below Firestore's batch ceiling. Row 151 and
  body over 256 KiB are rejected before persistence.
- Existing manual create/update and Activities bulk-grid endpoints still pass.

Exit criteria: both adapters provide equivalent all-or-nothing, idempotent behavior with
expense consistency.

## Phase 4: feature flags, usage control, and observability

1. Seed `activity_lodging_csv_import` and `activity_lodging_csv_export` disabled. Add
   descriptions that identify them as kill switches. Keep existing `csv_export` as the
   master switch and expose entity export only when both export flags resolve enabled.
2. Expose the flags from `/api/auth/features` with `isFeatureEnabled`, initialize client
   UI state false until fetched, and pass them to Activities and Lodging tabs. Import
   endpoints check the same flag through `assertCanUseFeature`; admins do not bypass an
   off feature flag.
3. Add mandatory `DATA_TRANSFER_API` configuration and callers
   `ACTIVITY_IMPORT_ROWS`/`LODGING_IMPORT_ROWS`. Reserve exactly the number of committed
   create/update rows once, after validation and before persistence, with
   `requireConfiguredLimit: true`. Add explicit zero pricing if required by admin views.
4. Add one HTTP burst reservation per commit for both user and IP (default 10/10 minutes),
   environment-configurable through project helpers. Return 429 and `Retry-After`.
5. Add privacy-safe structured logs and counters for entity, result code, row counts,
   duration, platform, and payload-size bucket. Hash or omit import IDs; never log file
   contents, row fields, filenames, addresses, notes, or auth tokens.
6. Add an operator runbook: check flags, tier entitlements, API limit configuration,
   422/409/429 dashboards, and rollback procedure. Alert on sustained 429 rates or
   transaction failures, not ordinary row warnings.

Tests:

- Enabled, disabled, and missing flag rows agree between feature response and endpoint.
- Tier denial is 402; trip edit denial is 403; disabled endpoint is 404.
- Usage reservations use row units once, hit caller/overall caps atomically under
  concurrency and process restart, require configuration, and do not count parse/preview.
- HTTP limiter is invoked once, isolates user/IP identities, and sends Retry-After.
- Rejected preflight requests do not consume row units; documented transaction failures
  after reservation are counted and logged without leaking data.

Exit criteria: imports cannot bypass flags, tier rules, trip authorization, aggregate
quota, or burst controls, and operators can distinguish each failure mode.

## Phase 5: cross-platform file adapters

1. Add `expo-document-picker` using the Expo SDK 54-compatible `npx expo install`
   resolution. Keep existing `expo-file-system` and `expo-sharing` versions aligned with
   the current SDK.
2. Define a small platform interface (`pickCsvFile`, `shareCsvFile`) and implement it in
   `.web.ts` and `.native.ts` files so platform bundlers resolve only compatible code.
3. Web picker: `.csv` accept hint, `File.text()`, input-value reset, cancellation handling,
   2-MiB precheck, and cleanup. Web export: Blob/object URL, download attribute, and URL
   revoke in `finally`.
4. Native picker: `copyToCacheDirectory: true`, CSV MIME variants and extension fallback,
   cancellation handling, then `new File(uri).text()` using Expo FileSystem 19. Do not use
   the deprecated main-module `readAsStringAsync` API.
5. Native export: create under `Paths.cache`, write UTF-8 text, verify sharing availability,
   invoke share sheet with CSV MIME/UTI, handle user cancellation, and best-effort delete.
6. Provide user-facing errors for unsupported sharing, inaccessible content URI, invalid
   extension, empty file, and size limit without exposing raw platform errors.

Tests:

- Jest platform-resolution tests with mocks for document picker, FileSystem `File`/`Paths`,
  Sharing, browser File/Blob/URL, same-file reselection, cancellation, and cleanup.
- Typecheck both platform files. Ensure no DOM types leak into native and no native module
  is eagerly executed by web tests.
- Manual device checks with Files/iCloud Drive on iOS and Files/Drive providers on Android,
  including filenames with spaces/Unicode and share-sheet cancel.

Exit criteria: the same CSV can be selected/read and a canonical export can be shared on
all three platforms without deprecated API calls or leaked temporary files.

## Phase 6: import review UI

1. Add Import actions to Activities and Lodging only when a trip is selected, edit mode is
   allowed, and the import flag is enabled. Disable while trip data is loading or stale.
2. Build the flow as explicit states: Pick -> Map -> Review -> Commit -> Result. Navigation
   back preserves edits; closing warns about uncommitted review changes.
3. Mapping shows source headers, explicit automatic aliases, ignored-column samples, and
   errors for duplicate destinations. Non-empty ignored columns require acknowledgement.
4. Review shows create/update/skip counts, blocking errors, warnings, source row numbers,
   and before/after diffs for explicit updates. Refresh current records immediately before
   commit and keep the server fingerprint check as the final authority.
5. Web may use `EditableDataGrid` with virtualization. Native uses a full-screen safe-area
   modal/screen and one `FlatList`/`SectionList` of expandable editable cards; do not nest it
   in `ScrollView`. Memoize rows and index matches to avoid O(n^2) rerenders.
6. Keep actions above keyboard and bottom inset, use at least 44-point targets, support
   large text/rotation, label all controls for screen readers, restore focus after dialogs,
   and pair warning colors with icons/text.
7. **Show progress indicator** during the commit phase and disable the commit button.
8. Disable double submit once pressed and reuse one `importId` for network retry. On 409,
   refresh and return to review; on 422, focus the first bad row; on 429, show retry timing;
   on success, refresh the tab once and show created/updated/skipped counts.

Component/integration tests:

- Flag/read-only/loading visibility and disabled states on both tabs.
- Pick, mapping acknowledgement, edits, exclude/restore, explicit existing-record update,
  cancel, double-click suppression, retry with stable import ID, and each error response.
- 101-row virtualized review remains navigable; a same-name/date pair remains two cards.
- Native safe-area/keyboard layout, list-not-in-ScrollView assertion, accessibility roles,
  labels, focus, and large-text snapshot/screenshot coverage.
- Web Playwright happy path and validation path with network interception; confirm exact
  request shape and one post-success refresh.

Exit criteria: a user can safely understand every write before committing on desktop or
phone, and error recovery never requires reselecting the file unless desired.

## Phase 7: export UI and canonical round trip

1. Add Export actions under the export flag. Permit read-only users only when they can
   already read the entity data. Refresh the selected trip list first; block with a clear
   error if refresh fails rather than exporting an incomplete cached page.
2. Offer `WanderBunnies CSV` only in version 1. Generate through the Phase 2 writer and
   Phase 5 platform share adapter. Use sanitized `{trip}-{activities|lodging}-{date}.csv`.
3. Explain that canonical CSV is re-importable and ISO-dated. Label record ID/fingerprint
   columns as same-trip update hints and ignore them across trips.
4. Include all approved portable fields and same-trip record ID/fingerprint hints, but no
   owner/auth IDs, payer/traveler assignments, image URLs, votes, ratings, or other hidden
   data. Re-import makes its payer/traveler defaults visible in review.
5. Do not meter local export as an external/API call. Log only a privacy-safe client event
   if the application already has an approved analytics path.

Tests:

- Activity and lodging canonical export -> import -> normalized equality, except that
  formula-like text intentionally retains its export safety apostrophe.
- Formula-injection and CSV escaping cases run through actual platform writer adapters.
- Flag/read authorization, loading failure, empty list, sanitized filename, one refresh,
  object URL revoke, temporary-file cleanup, and share cancellation.
- Playwright verifies a real web download and its parsed contents; device tests verify iOS
  and Android share sheets can hand the file to another app.

Exit criteria: exported files are safe, complete, platform-shareable, and can be reviewed
for re-import without manual header mapping.

## Phase 8: build, release, and operational gate

Run before enabling either flag:

```bash
cd app
npm run typecheck
npm test -- --runInBand
npm run export:web

cd ../server
npm run build
npm test -- --runInBand
```

Also require:

- A production-profile EAS iOS build and Android build after adding document picker.
- Smoke tests on Safari/Chrome/Firefox, a small supported iPhone, a large/rotated iPhone,
  and at least one supported Android phone.
- **Verify expense consistency**: Check that activities/lodgings with costs correctly
  create/update expense records after a bulk import.
- Bundle-size comparison against baseline; investigate unexpected parser/native-module
  growth. A 101-row parse/review/commit performance trace on a lower-memory device.
- Firebase emulator integration or a controlled staging Firebase run proving batch
  atomicity and rules; Postgres staging migration/rollback rehearsal.
- Security review for CSV formula injection, DTO pollution/unknown keys, cross-trip IDs,
  log redaction, oversized input, and replay/concurrent commits.
- Accessibility pass with keyboard-only web, VoiceOver, TalkBack, and large text.

Rollout:

1. Deploy schema/backend with both flags off and verify migrations, configured usage
   limits, metrics, and admin flag visibility.
2. Enable export for admins/staging, then import for admins/staging. Run both full fixtures
   and verify entity/expense counts and idempotent replay.
3. Enable a small production cohort/tier, monitor 409/422/429 and transaction latency,
   then broaden. Either flag can be disabled independently without removing existing data.
4. Keep XLSX out of scope. If later prioritized, write a separate design covering lazy
   loading, web/native memory, package license/security, bundle size, sheet selection,
   formula treatment, and an independent `activity_lodging_xlsx` flag.

## Definition of done

- Every architecture acceptance criterion has an automated test or named manual build/
  device check.
- Both supplied examples import without silent data loss and canonical files round-trip.
- Persistence and expense mirrors are atomic and idempotent across Postgres, Firebase,
  and pg-mem-backed tests.
- Feature, entitlement, usage, burst, privacy, and concurrency controls are verified.
- Web export, iOS/Android builds, native picker/share, responsive UI, and accessibility pass.
- Documentation/runbook describes flags, limits, metrics, known CSV limits, and rollback.
