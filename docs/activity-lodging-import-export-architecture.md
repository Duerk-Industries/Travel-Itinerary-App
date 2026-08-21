# Activity & Lodging Import/Export — Architecture

## Status
Design only — no code written yet. Companion implementation plan:
[`implementation_plans/activity-lodging-import-export-implementation-plan.md`](implementation_plans/activity-lodging-import-export-implementation-plan.md)

## Goal

Let a trip's Activities and Lodging tabs import rows from a spreadsheet (CSV, and Excel
where practical) exported from a planning doc like Google Sheets, and export the
current trip data back out in the same shape. Reference source files used to derive
the field mapping: `Japan Checklist - Activities-1.csv`, `Japan Checklist - Lodging.csv`.

## Schema changes (prerequisite, land first)

These are small, additive, and unblock the rest of the feature. All three DB adapters
(`db.postgres.ts`, `db.firebase.ts`, `db.memory.ts`) must stay in sync per
`CLAUDE.md`'s database-changes convention; `db.memory.ts` spreads `...postgresAdapter`
so it inherits new functions automatically, but new *columns* still need to round-trip
correctly through whichever adapter builds the row object.

### 1. `ActivityType` enum: add `'Other'` and `'Drive'`

Neither exists today in `app/tabs/activities.tsx` (`ACTIVITY_TYPES`). `'Drive'` covers
CSV rows like the Magome→Tsumago walk or any point-to-point transfer-by-car activity
that isn't a `CarRental` record; `'Other'` is the catch-all so the synonym-mapping
fallback (see below) never has to force a bad guess onto a genuinely uncategorizable
row.

- `server/src/types.ts` — `ActivityType` union
- `app/tabs/activities.tsx` — `ACTIVITY_TYPES` array (single source the UI reads from;
  `types.ts` should mirror it exactly, alphabetized to match the existing list style)
- No DB migration needed — `activityType` is stored as free text, not a DB-level enum
  constraint (verify this assumption in the postgres schema during implementation;
  if it *is* a `CHECK` constraint or Postgres `ENUM` type, that needs a migration too)

### 2. Hidden `latitude`/`longitude` on `Activity` and `Lodging`

Naming: match the existing convention in `lodgingLocationService.ts`
(`latitude?: number | null`, `longitude?: number | null`) rather than the `Airport`
type's `lat`/`lng` shorthand — these are user-facing data models, not a compact
internal cache row.

- `server/src/types.ts`: add `latitude?: number | null; longitude?: number | null;`
  to both `Activity` and `Lodging`
- `db.postgres.ts`: new nullable columns `latitude double precision`,
  `longitude double precision` on `activities` and `lodgings` tables; migration file
  alongside `db.postgres.ts` per convention
- `db.firebase.ts`: add the two fields to the Firestore document mapping (read + write)
- Not exposed in any create/edit form — populated only when a resolve step
  (Google Places lookup via `googlePlaces.ts` / `placeService.ts`, already used
  elsewhere for `place_id`/`placeId`) runs and returns coordinates. Nothing today
  calls that resolve path for activities or lodging line items, so until that lands
  these columns simply stay null. They're being added now so any future geocode/
  "distance between today's stops" feature doesn't need another migration, and so
  an import that *does* have coordinates in-hand (e.g. from a future Google Maps
  export format) has somewhere to put them immediately.
- Not part of CSV import/export in v1 — the sample CSVs have no coordinates, and
  there's no resolve call wired up yet. Excluding from both the import mapping table
  and the export column list; add both once a resolve call exists and is triggered.

### 3. Lodging `notes` field

Already covered by the import design below — `Breakfast?`/`Dinner?`/`Laundry?`/
`Booked On` from the source CSV have nowhere to go without it (`Lodging` currently
has no free-text field at all, unlike `Activity`'s `notes`).

- `server/src/types.ts`: `Lodging.notes?: string`
- `db.postgres.ts` / `db.firebase.ts` / migration, same pattern as above

### 4. Lodging `features: string[]` (tags)

New multi-value tag field, distinct from `notes`. Three preset tags —
**Breakfast**, **Dinner**, **Laundry** — plus free-form short custom text tags
(e.g. "Pool", "Late checkout", "Walk to station"). This replaces the CSV's
`Breakfast?`/`Dinner?`/`Laundry?` *boolean* columns with a cleaner tag-presence
model: a tag present in `features` means "yes, this lodging has it"; absent means
either "no" or "unknown" (the CSV's `$9/per` and `Near` values in those columns
don't fit a strict boolean anyway — see the import mapping note below).

- `server/src/types.ts`: `Lodging.features?: string[]`
- `db.postgres.ts`: new column, `text[]` (Postgres native array type, consistent
  with existing `paid_by`/`traveler_ids` array columns on the same table)
- `db.firebase.ts`: Firestore array field
- `db.memory.ts` / pg-mem: verify `text[]` columns are supported by pg-mem for this
  table already (`paid_by` already uses one, so this should be a non-issue — pg-mem
  supports the type, just confirm insert/update queries for `features` follow the
  same parameterization as `paid_by`)
- UI: a small tag-input control on the lodging create/edit form
  (`app/components/LodgingForm.tsx`) — chips for the three presets plus a text
  input for custom tags with add/remove; likely also worth a column in the
  Lodging grid showing tag chips read-only, matching how other multi-value
  fields (`paidBy`) render in the grid today
- This does **not** replace `notes` — `notes` stays as the free-text overflow
  field for one-off details (Booked On source, cancellation nuances, etc.);
  `features` is for short, filterable/scannable tags

## CSV/Excel field mapping

### Activities CSV → `Activity`

| CSV column | Maps to | Notes |
|---|---|---|
| Date | `date` | No year in source — inferred from the trip's own start/end date range (see Import flow) |
| Activity Type | `activityType` | Synonym table + `'Other'` fallback (was previously going to fall back to `'Sights & Landmarks'`; `'Other'` is the correct fallback now that it exists) |
| Start Time | `startTime` | Blank allowed |
| Duration | `duration` | Stored as free text already, no coercion |
| Activity Name | `name` | direct |
| Activity Notes | `notes` | direct |
| Activity Start Address | `startLocation` | direct |
| Lodging Location | *(dropped)* | Not an `Activity` field |
| Book Ahead Required? | folded into `notes` | Prefixed, e.g. `[Book ahead: Yes — timed tickets] …` |
| — | `cost`, `freeCancelBy`, `bookedOn`, `reference`, `paidBy`, `status`, `latitude`, `longitude` | Not in source; defaulted (`cost: 0`, `status: Needed`, coordinates left null) and editable in the review grid before commit |

Updated `activityType` synonym table (see implementation plan for the full list):
`Temple/Shrine`, `Castle`, `Garden`, `Neighborhood`, `Sightseeing` → `Sights & Landmarks`;
`Onsen/Ryokan` → `Spa/Wellness`; `Food/Drink` → `Food & Drink`; `Hike` →
`Outdoor Activity`; `Market` → `Shopping`; `Free/Buffer` → `Open Access`. Anything
not in the table now falls back to **`Other`**, not a forced best-guess category.
`Drive` has no source-CSV synonym in this sample set but exists for future imports
(e.g. a source sheet that has explicit "Drive to X" rows) and for manual use.

### Lodging CSV → `Lodging`

| CSV column | Maps to | Notes |
|---|---|---|
| Check In / Check Out | `check_in_date` / `check_out_date` | Same year-inference rule as activities |
| Hotel | `name` | Blank rows (unbooked legs) are skipped on import with a warning, not imported as empty-name placeholders |
| Booked? | `status` | `Yes` → `Booked`, blank/`No` → `Needed` |
| Cancel By | `refund_by` | direct |
| Cost | `total_cost` | Strip `$`, reuse `sanitizeCostInput` |
| Address | `address` | direct |
| Days | *(derived only)* | Used to compute `cost_per_night = total_cost / days`, not stored |
| Suggested Location | folded into `address` prefix, or dropped | Low value once a real address is present |
| Breakfast? / Dinner? / Laundry? | `features` tags | `Yes` → add the matching preset tag. Non-boolean values in source (`$9/per`, `Near`) can't cleanly become a tag-presence flag — import surfaces these as a warning on the row and adds the tag anyway (presence beats absence), with the original text folded into `notes` so nothing is silently lost |
| Booked On | folded into `notes` | e.g. `Booked via Booking.com` — `Lodging` has no dedicated field for this and doesn't need one just for import |
| Rooms | *(not in CSV)* | Defaulted to `1`, editable in review grid |
| — | `latitude`, `longitude` | Not in source; left null |

### Excel support

`xlsx` (SheetJS) or `exceljs` — pure client-side parsing, no network call, so
"external API" is not actually a blocker. Recommended scope: **web only** for v1.
`<input type="file">` → `File.arrayBuffer()` → `xlsx.read()` works directly in the
browser bundle. Native (`expo-document-picker` + `expo-file-system` base64 read)
is a second code path for a feature that's realistically a desktop-planning-doc
workflow; gate Import/Export UI behind `Platform.OS === 'web'` and revisit only if
there's real native demand. The same library can also *write* `.xlsx`, so export
gets an Excel option for free from the same code path as CSV export.

## Import flow

1. User clicks **Import** on the Activities or Lodging tab (web only).
2. File picked (CSV or `.xlsx`) → parsed into rows of raw string cells.
3. Header row matched against known column names (case-insensitive, with the
   synonym/fuzzy list baked in from the sample CSVs above) to auto-map columns to
   fields. Any column that can't be confidently mapped is shown to the user for
   manual mapping before proceeding — never silently dropped without a chance to
   assign it.
4. Row-level transforms run: date year inference (against the trip's stored start/
   end date), activity-type synonym mapping with `'Other'` fallback, cost/number
   parsing, `features` tag derivation for lodging.
5. **Review grid** (reusing `EditableDataGrid`) shows every parsed row before
   anything is written: new rows vs. matched-existing rows (see dedupe below) are
   visually distinguished, validation warnings (unmapped type, blank required
   field, low-confidence date) are inline and non-blocking, and every cell remains
   editable. Rows can be individually excluded.
6. On confirm, the reviewed rows are sent to a bulk upsert endpoint.

### Duplicate handling

Match key: activities on `(name, date)`, lodging on `(name, check_in_date)`.
Matches against currently-loaded trip rows are shown as **Update** (diffed
old → new) in the review grid; non-matches are **New**. Each is individually
toggleable before commit. `POST /api/activities/bulk` and
`POST /api/lodgings/bulk` accept a mixed array of `{ id?, ...fields }` — an
`id` present means update, absent means insert — so the endpoint does a true
upsert in one request/transaction rather than the client branching between
create and update calls.

## Export flow

Mirrors import: a shared column-definition list per entity drives both the CSV/
Excel writer and the import column-mapping defaults, so round-tripping an
app-exported file back in requires no manual remapping. Export always emits the
app's own canonical headers (not the source-CSV's Google-Sheets-style headers);
import's fuzzy header matching is what makes the *original* style of CSV (like
the two sample files) import cleanly without the user renaming columns first.
`latitude`/`longitude` are excluded from the exported columns in v1 (see above);
add them once populated by a resolve call.

## Open items carried into the implementation plan

- Confirm whether `activityType` is a DB-level constrained type anywhere (would
  need a migration for the `Other`/`Drive` additions beyond the TS union)
- Exact synonym table entries beyond what's derivable from the two sample CSVs —
  expect to extend as real-world imports surface new source values
- Whether the Lodging grid should render `features` as chips or a comma list
