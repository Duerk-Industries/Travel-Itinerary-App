# Activity and Lodging CSV Import/Export Architecture

## Status and scope

Design only. No application code is part of this document change. The companion
delivery plan is
[`implementation_plans/activity-lodging-import-export-implementation-plan.md`](implementation_plans/activity-lodging-import-export-implementation-plan.md).

The two supplied Japan checklist CSVs are example data, not executable instructions.
They define the compatibility baseline:

- Activities: 101 rows and 9 columns. Dates omit the year, one start time is blank,
  duration is free text, and two name/date groups are legitimate duplicates.
- Lodging: 12 rows and 13 columns. Four rows have no hotel because they describe an
  unbooked location need. `Booked On` contains providers rather than dates, and amenity
  cells include qualified values such as `$9/per` and `Near`.

Version 1 imports and exports CSV on Expo web, iOS, and Android. XLSX is deliberately
deferred: it is not needed for the supplied files, adds bundle and memory cost, and
requires a separate dependency/security review. XLSX may later be enabled behind its
own flag without changing the canonical row model.

## Goals and non-goals

Goals:

- Import sample-shaped or similarly named CSV columns into the selected trip's
  Activities or Lodging page.
- Preview, validate, edit, exclude, and explicitly classify every row before a write.
- Preserve source information even when the current data model has no exact field.
- Commit accepted rows atomically and idempotently while preserving expense mirrors.
- Export a canonical, re-importable WanderBunnies CSV.
- Meter and rate-limit import commits in the same durable system used by other APIs.
- Provide responsive, accessible workflows on web, iPhone, and Android.

Non-goals for version 1:

- Executing formulas, macros, links, or instructions found in an imported file.
- Importing XLS/XLSX, Google Sheets URLs, coordinates, images, or place enrichment.
- Automatically overwriting a possible duplicate.
- Whole-file atomicity beyond the 150-row request limit. Larger files must be split
  and each part reviewed and committed separately.

## Design decisions that correct the original draft

1. **Do not reuse `PATCH /api/activities/bulk`.** That endpoint already exists for
   `feature_grid_editing`, accepts only updates/deletes, caps at 50 operations, returns
   partial results, and currently invokes its HTTP rate limiter twice. Import gets
   separate endpoints and a shared import service. The duplicate limiter invocation is
   a pre-existing bug to fix before relying on that route's patterns, but it is not a
   reason to couple imports to it.
2. **Do not add `Drive` or latitude/longitude for this capability.** `Hike` is already
   a valid activity type and must remain `Hike`; the sample contains no drive or
   coordinate columns. Speculative schema work increases adapter and migration risk.
3. **Add only fields needed to preserve lodging data:** optional `notes` and
   `features: string[]`. Add `Other` as the safe ActivityType fallback. Postgres stores
   `features` as JSONB, consistent with this table's existing `paid_by` and
   `traveler_ids` JSONB fields; Firestore stores an array. The pg-mem adapter reuses the
   Postgres implementation and must pass the same migrations and round-trip tests.
4. **Never use name/date alone as an update key.** It would merge legitimate rows such
   as two visits to the same attraction on one date. Exact duplicate suggestions and
   possible updates are distinct review states; updates always require user selection
   of a concrete existing record.
5. **Atomic means all-or-nothing.** Validation or concurrency errors write no activity,
   lodging, expense mirror, or successful import receipt. Per-row error reporting is
   returned from preflight validation, not from partially applied writes.
6. **CSV is supported on all app platforms.** Native uses Expo document, file, and
   sharing APIs behind platform adapters rather than a web-only file input.

## Data model additions

### Activity

- Add `Other` to the canonical `ActivityType` union, normalizer, UI options, and tests.
- Keep `Hike` as `Hike`. Do not add `Drive` in this project.
- No database migration is expected because activity type is stored as text; verify
  there is no production check constraint before release.

### Lodging

- `notes?: string | null`: free-form preserved source context.
- `features: string[]`: normalized, unique, trimmed tags such as `Breakfast`, `Dinner`,
  and `Laundry`.
- Postgres migration: nullable text `notes` and `features JSONB NOT NULL DEFAULT '[]'`.
- Firebase: tolerate missing legacy fields on read and write a native array on change.
- Update shared types, DTOs, adapters, create/edit form, detail dialog, and grid. Limit
  notes and tag lengths in both client and server validation.
- **UI Integration**: New fields must be visible and editable in `LodgingDetailsDialog`
  and `LodgingForm`. Features should be displayed as manageable tags/chips.

No import may write user IDs, ownership, trip IDs, image URLs, place IDs, votes, or
ratings from arbitrary CSV cells. Those values come from authenticated server context
or an explicitly reviewed canonical field with server-side authorization.

## Canonical import representation

Parsing produces raw string cells. Mapping then creates an entity-independent review
row instead of an API DTO:

```ts
type ImportReviewRow<TFields> = {
  sourceRow: number;
  action: 'create' | 'update' | 'skip';
  existingId?: string;
  expectedFingerprint?: string;
  fields: TFields;
  warnings: ImportIssue[];
  errors: ImportIssue[];
};
```

The client may suggest an action, but only the review screen changes a suggestion into
an explicit update. The server repeats normalization, authorization, duplicate ID
checks, field validation, and optimistic-concurrency checks; client validation is for
feedback, not trust.

## Header matching and parsing

- Use a maintained RFC 4180-compatible parser such as Papa Parse, not a hand-written
  comma splitter. Configure it for headers, quoted commas/newlines, escaped quotes,
  UTF-8 BOM, CRLF/LF, and empty-line skipping.
- Treat every imported value as literal data. Never evaluate spreadsheet formulas.
- Trim header whitespace and match case-insensitively against an explicit alias table.
  Do not use fuzzy edit-distance matching that can silently assign the wrong field.
- Show unknown columns as **Ignored** in mapping and require acknowledgement if a
  non-empty unknown column would be dropped.
- Reject duplicate mapped destination columns until the user resolves them.
- Enforce before parsing/commit: `.csv` extension or accepted MIME fallback, at most
  2 MiB, at most 150 non-empty data rows, at most 50 columns, and bounded cell lengths.
  MIME is advisory because Android document providers are inconsistent.
- Parse dates without `new Date(sourceString)`. Accept strict ISO `YYYY-MM-DD` or an
  explicit English `Mon DD`/weekday-month-day grammar. Strip the optional weekday and
  trailing comma, enumerate candidate years intersecting the trip range, and accept
  only one in-range result. Correctly handle year rollover such as November to December.
  Ambiguous or out-of-range values block the row until edited.
- Normalize times with an explicit 12/24-hour parser. Blank activity time is valid.
  Preserve duration as bounded free text (`1h30`, `Overnight`, `Flexible`).
- Parse currency with the existing cost sanitizer, require a finite non-negative
  amount, and never infer a currency from `$` unless the trip currency contract does so.

## Source mappings

### Activities

| Source header | Activity field | Rule |
|---|---|---|
| `Date` | `date` | Explicit year inference against trip dates |
| `Activity Type` | `activityType` | Alias table below; unknown becomes `Other` plus warning |
| `Start Time` | `startTime` | Blank allowed |
| `Duration` | `duration` | Preserve free text |
| `Activity Name` | `name` | Required after trim |
| `Activity Notes` | `notes` | Preserve text |
| `Activity Start Address` | `startLocation` | Preserve text |
| `Lodging Location` | `notes` | Append labelled source context; do not silently drop |
| `Book Ahead Required?` | `notes` | Append labelled source context when non-empty |

Activity type aliases:

- `Food/Drink` -> `Food & Drink`
- `Temple/Shrine`, `Castle`, `Garden`, `Museum`, `Neighborhood`, `Sightseeing` ->
  `Sights & Landmarks`
- `Hike` -> `Hike`
- `Market` -> `Shopping`
- `Onsen/Ryokan` -> `Spa/Wellness`
- `Free/Buffer` -> `Open Access`
- Unknown -> `Other`, while preserving the original value in a warning and notes

Defaults are `status: Needed`, `cost: 0`, and the trip's normal payer/traveler
defaults. All defaults are visible in review.

### Lodging

| Source header | Lodging field | Rule |
|---|---|---|
| `Check In`, `Check Out` | `checkInDate`, `checkOutDate` | Explicit year inference; checkout must follow check-in |
| `Hotel` | `name` | Use directly when present |
| `Suggested Location` | `name`, `notes` | If Hotel is blank, create `Lodging in {location}` with `Needed`; always preserve labelled location in notes |
| `Booked?` | `status` | Yes -> `Booked`; blank/No -> `Needed`; unknown warns |
| `Cancel By` | `refundBy` | Parse with the same explicit date rules |
| `Cost` | `totalCost` | Finite, non-negative normalized amount |
| `Address` | `address` | Preserve text; blank allowed for Needed rows |
| `Days` | validation only | Compare with calculated nights and warn on mismatch; never trust it as authoritative |
| `Breakfast?`, `Dinner?`, `Laundry?` | `features`, `notes` | Yes or a qualifier adds the tag; qualifiers such as `$9/per`/`Near` are also preserved in notes; No does not add a tag |
| `Booked On` | `notes` | Preserve as `Booked via: {value}`; it is a provider, not a date |

`rooms` defaults to 1. `costPerNight` is derived from normalized dates, total cost,
and room count using the same rule as the existing lodging form, never directly from
the source `Days` column. This preserves all four unbooked-location rows in the example.

## Duplicate and concurrency policy

The preview compares against a freshly loaded trip snapshot:

- Activity exact-duplicate fingerprint: normalized name, date, start time, and start
  location plus other material fields.
- Lodging exact-duplicate fingerprint: normalized name, check-in, checkout, address,
  and other material fields.
- An exact match defaults to **Skip**.
- A looser name/date match is **Possible existing record**, never an automatic update.
- The user may choose **Update** and select the existing record. The preview stores a
  fingerprint of that record's mutable fields.
- At commit, the server verifies the ID belongs to the selected trip and that the
  current server fingerprint matches `expectedFingerprint`. A mismatch returns 409
  with indexed conflicts and writes nothing. The client refreshes and returns to review.

This protects collaborative edits without requiring a speculative version column.

## Commit API and transaction contract

Add import-specific authenticated routes:

- `POST /api/activities/import`
- `POST /api/lodgings/import`

Request shape:

```json
{
  "tripId": "trip-id",
  "importId": "client-generated-uuid",
  "rows": [
    {
      "sourceRow": 2,
      "action": "create",
      "fields": {}
    }
  ]
}
```

Skipped rows remain client-side and are not sent. Updates also include `existingId`
and `expectedFingerprint`. Zod schemas are strict and cap 150 rows, reject unknown DTO
keys, bound strings/arrays, validate enums and finite numbers, and reject duplicate
source rows or target IDs. The route's JSON limit is 256 KiB even though local file
selection allows 2 MiB; the transformed DTO is intentionally smaller. Because the app's
global `express.json()` parser runs before ordinary entity routers, mount dedicated import
routers with `express.json({ limit: '256kb' })` before the global parser (as is already done
for special-body routes). Adding `bodyParser.json()` inside the existing late-mounted
entity router would be too late to change the effective limit.

Processing order:

1. Authenticate; check the import feature flag and tier entitlement.
2. Validate DTO, trip edit membership, target record ownership, traveler/payer member
   IDs, dates, and all optimistic fingerprints.
3. Acquire a short-lived durable idempotency claim keyed by
   `(userId, tripId, entity, importId)`. Return a stored successful response for an exact
   replay, reject key reuse with a different payload hash, and reject/wait on a concurrent
   in-progress claim without consuming quota. A lease permits recovery from a crashed
   worker; stale-lease takeover is logged.
4. Apply the per-user and per-IP HTTP burst limit exactly once for the claim owner.
5. Reserve `rows.length` durable API-usage units exactly once for that attempt with
   `requireConfiguredLimit: true`.
6. In one Postgres transaction or one Firestore transaction/batch, create/update all
   entity rows, create/update every corresponding expense-source row, and finalize the
   idempotency claim with its response. The Firebase implementation pre-reads needed documents and
   stays below the 500-write batch limit: 150 entities + 150 expense mirrors + receipt
   leaves headroom (301 total writes). Ensure `upsertExpenseForSource` logic is
   fully integrated into these atomic bulk operations.
7. Return a stable response with created/updated counts and normalized records.

Validation failures use 422, unauthorized trip/record access 403, concurrency or
idempotency mismatch 409, feature disabled 404, entitlement denial 402, and either
burst or usage exhaustion 429 with `Retry-After` when available. No response exposes
another user's record details.

Preflight validation runs before claim acquisition. A failed domain transaction writes no
entity or expense data and marks or expires only its control claim. If durable usage is
reserved but the later database transaction or process fails, the reservation remains
consumed as an abuse-control unit and is logged. A crash in the narrow interval between
usage reservation and claim-state persistence may conservatively overcount a recovered
attempt; it must never undercount or duplicate domain writes. The UI clearly distinguishes
quota errors from row validation errors.

## API usage, limits, and observability

Add a configured provider to `server/config/api-limits.yaml` rather than relying on the
limiter's fail-open behavior:

```yaml
DATA_TRANSFER_API:
  window: day
  windowHours: 24
  overall: 20000
  callers:
    ACTIVITY_IMPORT_ROWS: 15000
    LODGING_IMPORT_ROWS: 5000
```

The exact production numbers are operator-tunable, but configuration is mandatory.
Each accepted create/update row is one unit; local parsing, preview, and client-side
export use no external API and therefore consume zero API units. Add zero request
pricing if the admin cost dashboard requires an explicit entry.

Use a separate HTTP limiter, default 10 commits per user and IP per 10 minutes, with
environment overrides read through the project's environment helpers. Do not count
preview actions. Log structured import completion/failure events with import ID hash,
entity, counts, duration, platform, and error code; never log CSV contents, notes,
addresses, tokens, or raw filenames. Add metrics for attempted/accepted/skipped rows,
422/409/429 responses, transaction latency, and file/row size buckets.

No image/place API is called during import. In particular, lodging bulk commit must not
fan out the existing synchronous `getGooglePlaceImage` fallback for every row; that
would add latency and exhaust the metered Unsplash limit. Imported lodging images stay
null unless already present on an explicit update. Any future enrichment is a deferred,
bounded, separately flagged, cached, and independently metered job.

## Feature flags and authorization

Seed two independent flags, initially disabled until platform QA completes:

- `activity_lodging_csv_import`
- `activity_lodging_csv_export`

Expose import from `/api/auth/features` using `isFeatureEnabled`. Expose export as the
conjunction of `csv_export` (the existing master switch) and
`activity_lodging_csv_export`, also using `isFeatureEnabled`, so the public response and
server endpoint share the entitlement system's fail-open semantics. The app keeps
UI defaults false until the feature response resolves, then passes them to both tabs.
The server is authoritative for imports and uses `assertCanUseFeature`; hiding a button
is not authorization. Import is hidden/disabled in read-only/following mode. Export is
available only where the underlying entity list is already readable and is still UI-
gated by its flag. Flag tests cover enabled, disabled, and missing-row behavior, including
admin rules (feature flags have no admin bypass).

The existing generic `csv_export` flag remains unchanged and is the export master switch.

## Cross-platform file and UI architecture

Put platform behavior behind a small interface with `.web.ts` and `.native.ts`
implementations so Metro and webpack do not eagerly bundle incompatible code:

- `pickCsvFile()` returns name, size, and text.
- `shareCsvFile(filename, text)` downloads on web and invokes the share sheet on native.

Web:

- Hidden file input accepts `.csv`; reset its value after every selection so the same
  file can be chosen twice.
- Read with `File.text()`. Export with Blob/object URL, a sanitized filename, and always
  revoke the URL.

iOS/Android:

- Install the Expo SDK 54-compatible `expo-document-picker` with `expo install`.
- Pick with `copyToCacheDirectory: true`; allow CSV MIME variants plus extension
  fallback. Read with the Expo FileSystem 19 `File` API (`new File(uri).text()`), not
  the deprecated main-module `readAsStringAsync` path that throws at runtime.
- Write a temporary file under `Paths.cache`, check `Sharing.isAvailableAsync()`, call
  `Sharing.shareAsync()` with `text/csv` and the CSV UTI where supported, and best-effort
  delete the temporary file. User cancellation is not shown as an error.

The review UI is responsive rather than one desktop grid everywhere:

- **UI Progress**: The commit phase must show a progress indicator/spinner and disable
  the commit button to prevent double-submits. Successful imports should show a summary
  of changes (Created/Updated/Skipped counts) before returning to the main tab.
- Native uses a full-screen safe-area modal/screen with a single `FlatList` or
  `SectionList`, expandable row cards, memoized rows, and a sticky summary/commit bar.
  Do not nest a virtualized list inside `ScrollView`.
- Keep commit controls reachable above the keyboard and device bottom inset. Support
  rotation, small iPhones, large text, 44-point touch targets, VoiceOver/TalkBack labels,
  focus restoration, and warning text/icons rather than color alone.
- Parsing and transforms run once per file, not during every render. Keep only raw text
  plus normalized review rows and avoid repeated full-array copies. The 150-row cap and
  virtualization make the supplied 101-row activity file safe on lower-memory devices.

## Export format and security

The canonical CSV uses stable WanderBunnies headers and ISO dates. The same schema
definitions drive export and automatic import aliases. Include all portable supported
fields, including status, type, dates/times, names, locations/addresses, duration,
costs, cancellation date, reference, notes, and lodging rooms/features. Version 1 does
not export payer/traveler assignments because internal IDs are not portable and names
or email addresses create ambiguity/privacy risk; re-import applies the visible trip
defaults. Do not emit auth/owner IDs, image URLs, votes, ratings, or hidden internals.

`WanderBunnies Record ID` and `WanderBunnies Record Fingerprint` columns support explicit
same-trip update matching. Ignore them for a different trip and never trust
them without membership/fingerprint checks. A clear warning explains that sample-style
third-party columns may not round-trip one-for-one, while canonical exports do.

Serialize RFC 4180 CSV with CRLF and optional UTF-8 BOM for Excel compatibility. Quote
commas, quotes, and line breaks. Neutralize spreadsheet formula injection for text cells
whose first non-whitespace character is `=`, `+`, `-`, `@`, tab, or carriage return by
prefixing a single quote; numeric cells are emitted only after numeric validation.
Re-import never evaluates or automatically removes that protective prefix, because doing
so would make a literal leading apostrophe ambiguous. Sanitize filenames and include the
entity, trip name, and export date. Export refreshes the entity list first or blocks if
loading failed so it never silently exports a partial stale page.

## Acceptance criteria

- The full 101-row Activities example previews without collapsing legitimate rows; its
  blank start time and all source activity types are handled.
- All 12 Lodging rows preview, including four generated `Lodging in ...` Needed rows;
  provider and qualified amenity text are preserved.
- A validation/concurrency failure writes zero entity and expense records in Postgres,
  Firebase, and pg-mem tests; only bounded idempotency-control state may remain after a
  post-claim infrastructure failure.
- Retrying a successful `importId` does not duplicate records or consume another commit
  path; altered payload reuse is rejected.
- Import usage units, burst limits, feature flags, entitlement denials, and Retry-After
  behavior are tested and visible to operators.
- Canonical export re-imports to equivalent normalized rows and is formula-injection safe;
  intentionally neutralized formula-like text retains its safety apostrophe.
- Web export, iOS/Android picker/share flows, keyboard/safe-area behavior, accessibility,
  typechecks, Jest tests, Expo web export, and native release builds all pass before the
  flags are enabled.
