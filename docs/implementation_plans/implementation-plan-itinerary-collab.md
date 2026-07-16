# Itinerary Collaboration: Reactions + Add-Item Menu — Scoping Document

**Status:** Scoping. Not yet approved for implementation.
**Last updated:** 2026-04-25
**Authors:** assistant, in collaboration with @tristanduerk

---

## 1. Motivation

Two collaboration gaps surface when multiple users plan a trip together:

1. **No lightweight per-item feedback.** The existing voting system covers transfers,
   lodgings, activities, and car rentals (see `docs/faq/voting-on-items.md`) — but
   itinerary detail rows (the per-day items that show up under "Day 2 — Istanbul" in the
   overview) have no way for a group member to react. There is also no expressive
   reaction beyond thumbs up/down — heart, smile, etc. are not modeled today.

2. **Item creation is monolithic.** `POST /api/itineraries/:id/details` accepts a single
   `activity` string plus `time` and `cost`. There is no concept of a "place" (with
   geocode and photo), a "note" (free-form rich text), or a "checklist" (a parent item
   with toggleable children). Users currently work around this by stuffing structured
   data into the `activity` field as plain text.

This document scopes both features — they are independent and can ship separately or
together — and identifies the performance, memory, and test considerations for each.

---

## 2. Out of Scope

- Realtime broadcast of reactions / new items via WebSocket. Initial UX is request-on-
  toggle with optimistic UI. WebSocket integration is a follow-up tracked separately
  under `docs/realtime-sync-recommendation.md`.
- Per-emoji custom reactions. v1 ships a fixed allow-list of four reaction kinds.
- Reordering itinerary items by drag/drop. Items keep their existing day + time-based
  ordering.
- Unified reaction model across all trip items (flights, lodgings, etc.). Reactions
  v1 attach only to itinerary details. Generalizing to other entities should happen
  later with a deliberate cross-entity model.

---

## 3. Feature A — Item Reactions

> **v1 scope clarification (2026-04-25):** Ship plain up/down voting first.
> Score = `upCount − downCount`; one vote per user per detail; no multi-emoji.
> The schema below is purpose-built for that. Multi-emoji (heart, smile, etc.) is
> deferred and would require a follow-up migration that drops the
> `UNIQUE (detail_id, user_id)` constraint and adds an `emoji` column with
> `UNIQUE (detail_id, user_id, emoji)`. The new table is intentionally separate from
> `item_votes` so that future evolution doesn't perturb existing flight/lodging/
> activity/car-rental voting.

### 3.1 Data model

```sql
CREATE TABLE IF NOT EXISTS itinerary_detail_reactions (
  id UUID PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  detail_id UUID NOT NULL REFERENCES itinerary_details(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (detail_id, user_id)
);
CREATE INDEX idx_itinerary_detail_reactions_trip_detail
  ON itinerary_detail_reactions(trip_id, detail_id);
```

- `value` is `+1` (upvote) or `-1` (downvote). The SQL `CHECK` constraint enforces it.
- `UNIQUE (detail_id, user_id)` enforces one vote per user per detail. Switching from
  up to down is an upsert (`INSERT … ON CONFLICT (detail_id, user_id) DO UPDATE`).
- Cascade-deleting an `itinerary_detail` removes its reaction rows automatically. No
  manual cleanup is needed in the delete-detail handler.
- The new table mirrors the structural shape of `item_votes` but FKs to
  `itinerary_details` rather than carrying a polymorphic `(item_type, item_id)` pair.

### 3.2 API

Routes live under the existing itinerary data router, mirroring the current detail
routes (`/api/itineraries/details/:detailId`):

- `POST /api/itineraries/details/:detailId/reactions` — body `{ value: 1 | -1 }`.
  Upserts the row keyed by `(detail_id, user_id)`. Returns the updated summary for
  that detail.
- `DELETE /api/itineraries/details/:detailId/reactions` — clears the current user's
  vote on that detail. Returns the updated summary.
- `GET /api/itineraries/details/:detailId/reactions` — returns
  `{ score, upCount, downCount, userValue }`.
- The detail-list endpoint (`GET /api/itineraries/:id/details`) is augmented to inline
  the same summary on each row, so the list view does not require a follow-up fetch.

Authorization mirrors `item_votes`: only full trip members (not followers) can write
reactions; followers may read summaries.

Implementation touch points:

- Add DB adapter methods next to `castItemVote` / `getItemVoteSummaries`, named
  `castItineraryDetailReaction`, `clearItineraryDetailReaction`, and
  `getItineraryDetailReactionSummaries`.
- Add DTO parsing in a new `server/src/routes/itineraryDataDtos.ts`; the existing
  itinerary detail routes currently perform inline validation rather than using zod
  and will not be migrated as part of this feature.
- Feature flag checks should use `isFeatureEnabled('itinerary_reactions')` in the
  write routes (POST + DELETE). Reads may still return summaries when disabled so
  persisted data remains harmlessly visible, but the UI should hide the control.

### 3.3 UI

- New component `app/components/ReactionBar.tsx` — renders the four reaction icons
  with counts, highlights ones the current user has selected.
- Mounted under each itinerary detail row in `app/tabs/itineraries.tsx` (and
  `overview.tsx` if those rows are also rendered there). Hidden unless the caller
  passes `canReact === true`; the current itinerary/overview props do not expose
  `userRole`, so the implementation should propagate an explicit capability boolean.
- Optimistic update: toggle local state immediately, fire `POST` in background, roll
  back the local change on error and surface the failure via the existing
  `RetryableErrorBanner`.

### 3.4 Performance

- **Hot path is the list read.** The list endpoint must batch-summarize reactions
  across all detail IDs in the itinerary response in a single query. This follows the
  existing `getItemVoteSummaries` pattern in `db.postgres.ts:4457`: one aggregate
  query per itinerary detail list read, returning a `Record<detailId, ReactionSummary>`.
  Implementer must not call per-item summary endpoints in a loop.
- **Index coverage.** `idx_itinerary_detail_reactions_trip_detail` covers the
  list-read pattern (`WHERE trip_id = ? AND detail_id = ANY(...)`). The `UNIQUE
  (detail_id, user_id)` constraint doubles as the upsert-path index.
- **Toggle latency.** Optimistic UI hides any round-trip cost from the user. Backend
  upsert is a single `INSERT … ON CONFLICT (detail_id, user_id) DO UPDATE SET value =
  EXCLUDED.value, updated_at = NOW()` — no pre-read, no transaction needed.
- **N+1 risk on list views.** The list response inlines summaries; do not let a
  future refactor split this into a separate fetch. Add a regression test that
  asserts the list response includes the reaction summary on each detail.
- **Re-render churn on UI.** A `ReactionBar` per row in a 50-item itinerary will
  re-render on every parent state change unless memoized. Wrap the component in
  `React.memo` and key the props on `(detailId, score, userValue)` — primitive
  values that compare cheaply by reference.

### 3.5 Memory

- **DB.** Row size ~80 bytes. Realistic worst case: 50 trip members × 50 items × 4
  reactions = 10,000 rows ≈ 800 KB per trip. Negligible.
- **Server cache.** No new cache layer in v1. The summary query is fast enough.
- **Frontend.** Each detail gains ~200 bytes of inlined summary. A 7-day × 10-item
  itinerary = ~14 KB. Negligible.
- **Memory leak risk.** `ReactionBar` subscribes to nothing external — pure props in,
  no event listeners — so no teardown is required.

### 3.6 Tests

- `server/__tests__/itineraryDetailReactions.test.ts` (new):
  - upvote inserts row with `value = 1`; downvote inserts with `value = -1`
  - second POST with opposite value flips the existing row (no duplicate)
  - DELETE clears the user's vote and the summary reflects it
  - non-trip-member rejected with 403
  - cascading delete: deleting an itinerary detail removes its reactions
  - feature flag off → write routes return 403 with `FEATURE_DISABLED`
- `server/__tests__/itineraryDetails.list-reactions.test.ts` (new):
  - list endpoint inlines `{ score, upCount, downCount, userValue }` per row
  - empty reactions return `score: 0, upCount: 0, downCount: 0, userValue: null`
- `app/tests/ReactionBar.test.tsx` (new):
  - renders 👍 N 👎 with the user's current vote highlighted
  - clicking up optimistically updates score + highlight; click again clears it
  - rejects pending toggle on `fetch` error and rolls back local state
- `app/tests/itinerariesReactions.test.tsx` (new):
  - integration: detail rows mount `ReactionBar` with correct props
  - hidden when `canReact` is false

---

## 4. Feature B — Add-Item Menu (Place / Note / Checklist)

### 4.1 Data model decision

Three options were considered:

| Option | Pros | Cons |
|---|---|---|
| **A. Extend `itinerary_details` with `kind` discriminator + nullable type-specific columns** | One ordered list per day; existing routes survive; additive migration | Wider table, mostly-null columns |
| B. Three sibling tables (`itinerary_places`, `itinerary_notes`, `itinerary_checklists`) | Clean type isolation | Ordering across kinds requires a separate ordering table; three new fetch paths |
| C. Single polymorphic `itinerary_items` with `payload JSONB` | Maximally flexible | Loses SQL-level validation; harder to query for cost rollups |

**Recommendation: Option A.** It preserves the day-ordered single-list semantics the
overview already relies on, and the migration is purely additive. Type-specific data
that doesn't fit (notably checklist child rows) goes in a separate child table.

### 4.2 Schema additions

```sql
ALTER TABLE itinerary_details
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'activity'
    CHECK (kind IN ('activity', 'place', 'note', 'checklist')),
  ADD COLUMN place_id TEXT NULL,
  ADD COLUMN note_body TEXT NULL,
  ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS itinerary_checklist_items (
  id UUID PRIMARY KEY,
  detail_id UUID NOT NULL REFERENCES itinerary_details(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  checked_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  checked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_checklist_items_detail ON itinerary_checklist_items(detail_id, position);
```

- Existing rows backfill to `kind = 'activity'`. No code change needed for legacy data.
- `place_id` stores the Google Places place ID text. It intentionally does **not**
  reference `place_details_cache`: that cache has `place_id TEXT PRIMARY KEY` and is
  documented as standalone/truncatable in `20260426_add_place_details_cache.sql`.
  The row's required `activity` field remains the human-readable fallback label.
- `position` allows mixed-kind ordering within a day (the existing `time` field is too
  coarse and is optional).
- `checked_by` + `checked_at` track who completed each checklist item — important for
  group accountability.
- Keep `activity TEXT NOT NULL` as the display label for every kind:
  - `activity`: activity name
  - `place`: place name fallback when cache details are absent
  - `note`: short note title or first-line preview
  - `checklist`: checklist title

### 4.3 API

Extend the existing routes rather than fragment:

- `POST /api/itineraries/:id/details` — body gains optional `kind`, `placeId`,
  `noteBody`, `checklistItems: { label, position }[]`. Validation by `zod`
  discriminated union — kind dictates which fields are required.
- `PATCH /api/itineraries/details/:detailId` — same shape, partial. Keep the existing
  `PUT /api/itineraries/details/:detailId` route as a compatibility alias until the app
  has fully moved to PATCH semantics.
- `POST /api/itineraries/details/:detailId/checklist-items` — append a new child.
- `PATCH /api/itineraries/checklist-items/:id` — body `{ label?, checked? }`.
  Toggling `checked` true sets `checked_by` to the current user and `checked_at` to
  now; toggling false clears both.
- `DELETE /api/itineraries/checklist-items/:id`.

Place selection reuses the existing place search/details routes under `server/src/routes/placeRoutes.ts`;
no new lookup endpoint is required. The create-detail route stores the returned
`placeId` text and the selected place name in `activity`.

### 4.4 UI

- `app/components/AddItemPopover.tsx` (new) — anchored under each "+" button. Three
  rows: Add a place / Add a note / Add a checklist. Tap routes to a kind-specific
  dialog.
- `app/components/PlacePickerDialog.tsx` (new) — wraps existing
  `LocationSelector` (already memoized — see commit `c646590`). Returns a `placeId`.
- `app/components/NoteInputDialog.tsx` (new) — multi-line `TextInput`; render as
  plain text in v1. Do not route notes through `richText.tsx` until rich text is
  explicitly in scope.
- `app/components/ChecklistInputDialog.tsx` (new) — title field + dynamic list of
  child rows with add/remove buttons.
- `app/components/ItineraryItemRow.tsx` (new) — polymorphic on `kind`:
  - `activity`: existing rendering, unchanged
  - `place`: name + map link via `mapLinks.ts` + small thumbnail
  - `note`: plain text, preserving line breaks
  - `checklist`: title + nested `<Checkbox>` rows; tapping a row toggles its `checked`
    state with optimistic UI
- The existing inline "Day / Time / Activity / Cost" input row in
  [itineraries.tsx:939-981](../app/tabs/itineraries.tsx) becomes the "Add a custom
  activity" path — reachable from the popover as a fourth option, or kept as the
  default keyboard-driven add for power users.

### 4.5 Performance

- **List endpoint cost.** Adding a JOIN to `itinerary_checklist_items` increases the
  per-row cost. Mitigation: a single `LEFT JOIN ... GROUP BY` returning checklist
  children as a JSON aggregate, attached to the parent in the adapter layer. One query
  per day-fetch, not one per detail.
- **Place hydration.** When `place_id` is set, the list endpoint may `LEFT JOIN`
  `place_details_cache` on `place_details_cache.place_id = itinerary_details.place_id`
  so the frontend doesn't re-query Places. Because the cache is truncatable, place
  rendering must tolerate a missing joined row and fall back to `activity`.
- **Bundle size.** Three new dialogs add ~15–25 KB minified. Mitigation: lazy-load
  each dialog with `React.lazy` so cold open of the itinerary tab is unaffected;
  dialogs hydrate only when the popover triggers them.
- **Render cost on long itineraries.** A 50-item day with mixed kinds can generate a
  deep render tree. Memoize `ItineraryItemRow` by detail ID + a derived hash of the
  kind-specific payload.
- **Checklist toggle.** Optimistic UI; backend write is a single row update.
- **Place photos.** Loading photo thumbnails is the most expensive piece. Use the
  existing `useImageSource` / `useImageSourceGetter` pattern from
  `app/utils/imageSource.ts`, which keeps image source object references stable across
  renders. Cap thumbnails to 96x96 in row view.

### 4.6 Memory

- **DB.** A 7-day trip with 10 items/day, half of which are checklists with 5
  children each = 70 details + 175 checklist items ≈ 35 KB on disk per trip.
- **Server.** No new caches. The Places cache already exists.
- **Frontend.** Detail objects grow by ~50 bytes (kind + place_id + position) plus,
  for checklist parents, an array of children (~80 bytes each). Same 7-day trip ≈
  20 KB total. Negligible.
- **Image memory.** Place thumbnails are the only meaningful contributor. Cap them
  to 96×96 in the row view; full-size loads only on detail dialog open.
- **Leak risk.** Place picker and note dialog allocate listeners (autocomplete,
  debounce timers). All must clean up in `useEffect` return; pattern already
  established in `useCreateTripWizard.ts`.

### 4.7 Tests

- `server/__tests__/itineraryItemKinds.test.ts` (new):
  - create each kind; required fields enforced by zod (e.g. `place` requires
    `placeId`, `note` requires `noteBody`)
  - list endpoint returns mixed kinds in a single response
  - existing `activity`-kind rows still parse and render
- `server/__tests__/checklistItems.test.ts` (new):
  - add / patch / delete child items
  - position ordering preserved
  - checking sets `checked_by` and `checked_at`; unchecking clears both
  - cascading delete: removing a parent detail removes its children
  - non-trip-member rejected with 403
- `server/__tests__/initDbAutoMigrations.test.ts` (extend existing):
  - new `kind`, `place_id`, `note_body`, `position` columns present and nullable where
    expected
  - existing rows backfill to `kind = 'activity'`
  - new `itinerary_checklist_items` table created on fresh init and on upgrade from
    a pre-feature DB
- `app/tests/AddItemPopover.test.tsx` (new):
  - menu renders three options
  - selecting each fires the correct callback
- `app/tests/itineraryItemRows.test.tsx` (new):
  - each kind renders its specific layout
  - place row renders map link via `mapLinks.ts`
  - note row renders plain text with line breaks preserved
  - checklist toggling fires optimistic update + PATCH
- `app/tests/lazyDialogs.test.tsx` (new):
  - assert that opening the itinerary tab does not import the three dialog modules
    (verifies lazy-load)

---

## 5. Cross-cutting Concerns

### 5.1 Migrations

> **As shipped (2026-04-25):** the three planned per-feature migrations were
> consolidated into a single file
> `server/migrations/20260427_add_itinerary_collaboration.sql` (+ rollback).
> The migration runner applies one BEGIN/COMMIT per file, so per-`initDb`
> overhead in tests scales with the number of files. Bundling the schema
> changes restored test-suite throughput from ~750s → ~225s without
> changing any production semantics.

Phase 1 + Phase 2 schema lives in a single additive migration:

- `server/migrations/20260427_add_itinerary_collaboration.sql` (+ rollback)
  - Creates `itinerary_detail_reactions` (Phase 1)
  - Adds `kind`, `place_id`, `note_body`, `position` columns to
    `itinerary_details` (Phase 2)
  - Creates `itinerary_checklist_items` (Phase 2)

Also update the DB adapter exports in `server/src/db.ts` and the shared
`ItineraryDetail` types in `server/src/types.ts`, `app/tabs/itineraries.tsx`,
and `app/tabs/overview.tsx`. Existing migration drift guards in
`migrationDriftGuard.test.ts` will catch any schema/code drift.

### 5.2 Feature flags

Per `docs/feature-flags.md` — both features gate behind flags so they can be ramped
or rolled back without redeploy:

- `itinerary_reactions` — default `true` once shipped; flipping `false` hides the
  `ReactionBar` and disables the write endpoints (returns 403 with `FEATURE_DISABLED`
  code).
- `itinerary_item_kinds` — default `true` once shipped; flipping `false` makes the
  popover render only "Add a custom activity" (the legacy path) and the new dialogs
  unmount.

Flag values are checked once per request via the existing `isFeatureEnabled` cache
(60s TTL), so the perf cost is amortized.

During development, seed both flags in `server/config/feature-flags.yaml` and document
them in `docs/feature-flags.md`. If the backend lands before the UI is ready, seed the
flags as `false` in shared environments and flip them via the admin feature UI for
testing.

### 5.3 Tier gating (optional)

Reactions are universally available — collaboration is core. The `+` menu's "Add a
place" includes a Google Places lookup, which costs money per request. Consider
gating "Add a place" behind a `place_lookups_per_month` tier limit (`free` = 50,
`pro` = unlimited). Implementation hooks already exist in
`assertAndIncrementGenerationCount` — extend the same pattern.

This is a recommendation, not a requirement for v1.

### 5.4 Realtime (deferred)

Both features are single-fetch with optimistic UI in v1. Adding WebSocket
broadcasts (so user A sees user B's reaction without a page reload) is straightforward
once `socket/chatHandler.ts` is generalized — tracked in
`docs/realtime-sync-recommendation.md`.

---

## 6. Phasing

The two features are independent. Recommended order:

1. **Reactions first.** Smaller, self-contained, immediately useful. ~1 week including
   tests.
2. **Add-item menu second.** Larger surface area; benefits from the patterns
   established in (1) — reusable dialog scaffolding, lazy-load conventions,
   optimistic-UI helpers. ~2 weeks including tests.

Either feature can ship alone behind its flag.

---

## 7. Resolved Questions

1. **Reaction set.** Lock v1 to `thumbs_up / thumbs_down / heart / smile`. More emoji
   can be added later after usage data.
2. **Note rendering.** Plain text in v1. Store `note_body` as text and preserve line
   breaks in the row renderer; defer `richText.tsx` support.
3. **Checklist completion semantics.** Any full trip member can check or uncheck any
   item. Followers cannot mutate checklist state.
4. **Place item without internet/cache.** Render the stored `activity` string as the
   place label. Place cache data is enhancement-only.
5. **Reaction permissions.** Followers can read reaction summaries but cannot react.
   This matches existing vote permissions.
6. **Position vs. time ordering.** Sort by `day ASC`, then items with a non-null `time`
   before untimed items, then `time ASC`, then `position ASC`, then `created_at ASC`.
   `position` supplements `time`; it does not override it.

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Reaction toggle round-trips feel slow on flaky networks | Low engagement | Optimistic UI; rollback toast on failure |
| `ItineraryItemRow` polymorphism balloons render time on large itineraries | UI lag | `React.memo` + payload-hash key; row virtualization if >100 items |
| Place lookups blow past Google quota | Outage / cost | Existing `place_details_cache` absorbs reads; gate "Add a place" behind a tier limit |
| Migrations leave the table in a half-state on partial rollback | Schema drift | Each migration ships with a tested rollback; `migrationDriftGuard.test.ts` enforces parity |
| Lazy-loaded dialogs fail to load on poor connections | Confused user | `React.lazy` + `Suspense` fallback with a retry button; fall back to legacy inline add path |

---

## 9. Acceptance Criteria

- All new tests pass; existing 223+ test count grows by an estimated ~25–35 tests.
- TypeScript clean (no new `any` outside integration boundaries).
- Both feature flags can be flipped at runtime and the UI / API respect them within
  60s (the existing flag cache TTL).
- Active trip with the existing test data renders identically with both flags off
  (no behavior change to legacy `activity`-kind rows).
- A user reacting on item X sees their reaction persist across reload.
- A user adding a place / note / checklist sees it appear in the day list ordered by
  `time` then `position`.
