# Activity & Lodging Import/Export — Implementation Plan

Companion architecture doc:
[`../activity-lodging-import-export-architecture.md`](../activity-lodging-import-export-architecture.md)

No code has been written yet. This plan sequences the work into independently
shippable phases; each phase should land with its own tests before the next starts.

---

## Phase 0 — Schema & type groundwork

Prerequisite for everything else. Touches `server/src/types.ts` and all three DB
adapters. Land and test in isolation (existing create/edit flows for activities and
lodging must keep working unchanged).

1. **`ActivityType`: add `'Other'` and `'Drive'`**
   - `server/src/types.ts` — extend the `ActivityType` union
   - `app/tabs/activities.tsx` — extend `ACTIVITY_TYPES` array to match
   - Check whether `db.postgres.ts` enforces `activityType` via a `CHECK` constraint
     or Postgres `ENUM` type; if so, add a migration to widen it. If it's stored as
     plain text (expected), no DB migration needed.
   - Verify any place that renders/validates `ActivityType` exhaustively (e.g. a
     switch statement with no `default`) — TypeScript will flag these once the
     union grows, but grep for `ACTIVITY_TYPES` and `ActivityType` usages first to
     catch anything not type-checked (e.g. server-side string comparisons).

2. **`latitude`/`longitude` on `Activity` and `Lodging`**
   - `server/src/types.ts`: `latitude?: number | null; longitude?: number | null;`
     on both interfaces
   - Migration: nullable `double precision` columns on `activities` and `lodgings`
     tables in `db.postgres.ts`
   - `db.firebase.ts`: include both fields in document read/write mapping
     (Firestore has no schema, but the adapter's TS mapping functions need the
     fields added so they don't get silently stripped)
   - `db.memory.ts`: confirm pg-mem accepts the new columns via the inherited
     postgres SQL (should be automatic since it spreads `...postgresAdapter`, but
     the `CREATE TABLE` / migration statements pg-mem runs at test setup need the
     columns too — check wherever the in-memory schema is bootstrapped)
   - No UI exposure. No form field. Not part of import/export column lists yet.
   - Test: round-trip a create + fetch through each adapter and assert the field
     is `null` by default and persists a value when explicitly set (exercises the
     column existing and being read back correctly, even with nothing writing to
     it yet in production code paths).

3. **`Lodging.notes`**
   - `server/src/types.ts`: `notes?: string`
   - `db.postgres.ts` migration (nullable `text`), `db.firebase.ts` mapping,
     `db.memory.ts` schema bootstrap
   - Expose in `app/components/LodgingForm.tsx` as a plain multiline text input
     (matches how `Activity`'s `notes` is edited, for consistency) — this makes
     the field usable standalone, not just as an import target
   - Test: create/update lodging via API with `notes` set and unset

4. **`Lodging.features: string[]`**
   - `server/src/types.ts`: `features?: string[]`
   - `db.postgres.ts`: `text[]` column, following the existing `paid_by` array
     column pattern on the same table (same parameterized-array insert/update
     style)
   - `db.firebase.ts`: array field
   - `db.memory.ts`: confirm `text[]` works for a second column on `lodgings`
     (already proven by `paid_by`, but verify the memory adapter's row-mapping
     code isn't hardcoded to a single array column)
   - UI: tag-input control on `LodgingForm.tsx`
     - Three preset chips: **Breakfast**, **Dinner**, **Laundry** — tap to
       toggle on/off (add/remove from the `features` array)
     - Free-text input to add a custom tag (short — recommend a max length,
       e.g. 24 chars, enforced client-side); added tags render as removable
       chips alongside the presets
     - Preset chips should render in their toggled-on state if already present
       in `features`, and stay available to re-add if removed
   - Grid: add a read-only `features` column to the Lodging list view rendering
     chips (or a comma-joined string if chip rendering in the grid is
     disproportionate effort — decide during implementation based on how
     `EditableDataGrid` handles other array columns like `paidBy` today)
   - Test: form add/remove of preset and custom tags; API persistence;
     grid rendering with 0, 1, and multiple tags

**Phase 0 exit criteria:** existing activity/lodging create, edit, list, and
delete flows pass unchanged; new fields persist and round-trip through all three
adapters; `Lodging.notes` and `Lodging.features` are usable from the UI
independent of import (since real users may want tags/notes without ever
importing a CSV).

---

## Phase 1 — Parsing utilities (no UI yet)

New file `app/utils/spreadsheet.ts`, pure functions, unit-testable without any
component rendering.

1. **CSV parser**: hand-rolled RFC4180-ish reader (quoted fields, embedded commas/
   newlines, doubled-quote escaping) — mirrors the escaping logic already in
   `app/utils/csv.ts`'s `escapeCsvCell`, just inverted. No dependency needed.
2. **XLSX parser**: wrap `xlsx` (SheetJS) `read()`/`utils.sheet_to_json()` (or
   `sheet_to_csv` piped through the CSV parser above, to keep a single row-shape
   downstream of parsing). Import gated behind `Platform.OS === 'web'` at the call
   site, not inside this util (keep the util platform-agnostic; the tab decides
   whether to offer the file picker).
3. **Header mapping**: `mapHeaders(headerRow: string[], knownColumns: ColumnDef[]): { mapping, unmapped }` —
   case-insensitive exact match first, then a small fuzzy/synonym list per entity
   (derived from the two sample CSVs' actual headers, e.g. `Activity Name` → `name`,
   `Hotel` → `name`, `Cancel By` → `refund_by`). Anything left unmapped is returned
   for the UI to prompt on, not silently dropped.
4. **Row transforms**, one function per concern so they're independently testable:
   - `resolveImportYear(monthDay: string, tripStart: string, tripEnd: string): { date: string } | { error: string }`
   - `mapActivityType(raw: string): { type: ActivityType; matched: boolean }` —
     synonym table from the architecture doc; `matched: false` when it fell back
     to `'Other'`, so the review grid can flag it
   - `parseCost(raw: string): number` — reuse `sanitizeCostInput` from
     `app/utils/sanitizeCost.ts`
   - `deriveLodgingFeatures(row): { features: string[]; warnings: string[] }` —
     `Yes` → add preset tag; non-boolean values (`$9/per`, `Near`) → add the tag
     anyway plus a warning, per the architecture doc's stated behavior
   - `buildActivityNotes(row): string` / `buildLodgingNotes(row): string` — fold
     the no-home-field columns (`Book Ahead Required?`, `Booked On`, `Suggested
     Location`) into the notes prefix format documented in the architecture doc
5. **Column definitions**: one shared `ACTIVITY_COLUMNS` / `LODGING_COLUMNS` array
   (canonical header, field key, parser fn) used by both the import mapper and the
   export writer, so the two stay in sync by construction rather than by
   convention.
6. **Export writer**: `toActivitiesCsv(rows)`, `toLodgingCsv(rows)` following the
   existing `convertExpensesToCsv` shape in `csv.ts`; `toActivitiesXlsx`/
   `toLodgingXlsx` via SheetJS `utils.json_to_sheet` + `writeFile`, web-only.

**Tests**: this phase is almost entirely unit tests — feed the two sample CSVs
(check them into `app/tests/fixtures/`) through the full parse → map → transform
pipeline and assert on the resulting row objects, including the known-tricky
cases (blank Start Time row, `Free/Buffer` type, `$9/per` breakfast value, the
Nov→Dec year rollover in the trip range).

**Phase 1 exit criteria:** given the two sample CSVs and a fixture trip date
range, the pipeline produces the exact row set documented in the architecture
doc's mapping tables, with correct warnings on the known-messy cells.

---

## Phase 2 — Bulk upsert endpoints

1. `POST /api/activities/bulk` — body: array of `{ id?: string; ...ActivityFields }`.
   Rows with `id` update (must belong to the trip; 404/skip with per-row error if
   not), rows without `id` insert. Single DB transaction; the endpoint returns a
   per-row result array (`{ index, id, status: 'created'|'updated'|'error', error?
   }`) rather than all-or-nothing, since the review grid already let the user
   exclude bad rows — a partial failure on the server (e.g. a race with another
   editor) shouldn't roll back the rows that succeeded.
2. `POST /api/lodgings/bulk` — same shape for `Lodging`.
3. Add both to `db.ts` facade + implement in `db.postgres.ts` and `db.firebase.ts`
   per the DB-adapter convention (`db.memory.ts` inherits via spread, verify the
   inherited transaction behavior works under pg-mem — pg-mem may not support real
   transactions, in which case fall back to sequential awaits in the memory
   adapter specifically, matching how other multi-step memory-adapter operations
   already work around pg-mem limitations per existing code).
4. Mount in `server/src/app.ts` under existing `/api/activities` and
   `/api/lodgings` route groups.
5. Entitlement check: bulk import could blow past `assertUnderActiveTripLimit`-
   style per-trip item caps if such a limit exists for activities/lodgings —
   check `entitlementService.ts` for any relevant limit key and apply it per-row
   (reject rows beyond the limit rather than failing the whole batch) if one
   exists; skip this if no such limit is currently enforced for these entities.

**Tests**: `server/__tests__/` — insert-only batch, update-only batch, mixed
batch, partial-failure batch (one row references a nonexistent id), empty batch.

**Phase 2 exit criteria:** bulk endpoints work standalone via `supertest`,
independent of any UI.

---

## Phase 3 — Import UI

1. **Entry point**: "Import" button in `activities.tsx` and `lodging.tsx` /
   `LodgingTab.tsx` header, `Platform.OS === 'web'` only.
2. **File picker**: `<input type="file" accept=".csv,.xlsx,.xls">`, read via
   `File.text()` (CSV) or `File.arrayBuffer()` (xlsx).
3. **Mapping step** (only shown when Phase 1's header mapping leaves unmapped
   columns): simple modal listing unmapped source columns with a dropdown of
   target fields (or "ignore this column").
4. **Review grid**: new component (or a mode of `EditableDataGrid`) rendering
   parsed rows with:
   - a status badge per row: New / Update (matched existing row) / Warning
     (unmapped type, low-confidence date, non-boolean feature value)
   - per-row include/exclude checkbox, default-checked
   - all cells editable inline before commit, reusing `EditableDataGrid`'s
     existing cell editors where field types match (select for `activityType`,
     text for names/notes, etc.)
   - for Update rows, an expandable old-value diff so the user can see what
     will change
5. **Commit**: send the included, possibly-edited rows to the Phase 2 bulk
   endpoint; show a summary toast/result (`N created, M updated, K skipped`);
   refresh the tab's data.
6. **Dedupe matching**: client-side, against the tab's already-loaded rows —
   `(name, date)` for activities, `(name, check_in_date)` for lodging — computed
   right after parsing, before the review grid renders, so New/Update status is
   known up front.

**Tests**: component/integration test with a fixture CSV file mocked through the
file input, asserting the review grid renders expected New/Update rows and that
confirming calls the bulk endpoint with the expected payload. E2E (Playwright)
smoke test for the full click-through if time allows.

**Phase 3 exit criteria:** importing each of the two sample CSVs end-to-end
through the UI produces the row set from Phase 1's fixture tests, visible in the
tab's grid afterward.

---

## Phase 4 — Export UI

1. **Entry point**: "Export" button (CSV + Excel options, or a small menu) in
   both tabs, web-only, next to Import.
2. Uses the same `ACTIVITY_COLUMNS`/`LODGING_COLUMNS` definitions and
   `toActivitiesCsv`/`toActivitiesXlsx` (etc.) writers from Phase 1.
3. Triggers a browser download (`Blob` + object URL `<a download>`, matching
   whatever pattern the existing cost-report CSV export in `dailyExpenses.tsx`
   already uses — check and reuse rather than reinventing).

**Tests**: unit test on the writer functions (already covered in Phase 1);
a thin UI test that clicking Export triggers a download with the right
filename/content-type.

**Phase 4 exit criteria:** exporting the current trip's activities/lodging and
re-importing the resulting file round-trips every field losslessly (using the
app's own canonical headers, no manual remapping needed on the way back in).

---

## Sequencing summary

| Phase | Depends on | Ships independently? |
|---|---|---|
| 0 — schema/types | — | Yes — usable immediately via forms even without import |
| 1 — parsing utils | Phase 0 types | Yes — pure functions, fully unit-tested standalone |
| 2 — bulk endpoints | Phase 0 schema | Yes — testable via supertest without any UI |
| 3 — import UI | Phases 0–2 | No — needs all three |
| 4 — export UI | Phase 1 (writers) | Partially — export alone doesn't need Phase 2/3, could ship first if sequencing needs to change |

Recommended order is as listed (0 → 1 → 2 → 3 → 4), but Phase 4 (export) has no
hard dependency on Phase 2/3 and could be pulled forward if shipping export
alone earlier is valuable on its own.

## Open items to resolve before/during implementation

- Confirm `activityType` isn't a DB-constrained enum (Phase 0, item 1)
- Confirm pg-mem transaction support for the bulk endpoints, or fall back to
  sequential writes in `db.memory.ts` (Phase 2)
- Decide chip-vs-text rendering for `features` in the Lodging grid (Phase 0)
- Confirm whether any entitlement limit applies to bulk-created activities/
  lodgings (Phase 2)
- Extend the header-synonym and activity-type-synonym tables as real-world
  source spreadsheets surface column names/values not present in the two
  sample CSVs
