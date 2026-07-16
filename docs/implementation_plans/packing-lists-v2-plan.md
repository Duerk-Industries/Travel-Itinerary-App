# Packing Lists v2 — Requirements and Architecture Plan

Status: proposed implementation plan; no application code has been changed by this document
Verified against: current repository state on 2026-07-15
Primary owners: server/data, database adapters, trip/account/admin routes, `PackingListTable`

## 0. Executive summary

The current implementation is a snapshot-and-merge system:

- `universal_packing_list_items` is copied into a new user's `user_packing_list_items`.
- A trip is initially populated from the current travelers' user lists, with universal defaults as a fallback.
- Later traveler additions merge their current user list; traveler removal does not retract packing-list items.
- `trip_packing_list_items` is unique by `(trip_id, category, label)` and only has the legacy nullable `source_user_id` provenance field.
- `PackingListTable` renders one flat list grouped by the `category` field inside a horizontal scroll view. It does not currently freeze headers/columns or reorder the current traveler.
- There is no `server/data/packing_lists` directory yet.

V2 should add a catalog of named preset lists, profile preferences, a personal custom list, trip-level manual additions, and explicit provenance. The trip list is materialized from contributions, but every materialized item retains enough provenance to retract only profile-derived contributions when a traveler leaves. Manually added trip lists/items remain independent of traveler membership.

Recommended implementation boundary:

- Keep the existing account custom-list editor, but redefine its data as personal-only items.
- Add General as the universal baseline preset, selected by default and not removable from a profile.
- Materialize profile contributions when membership is added and reconcile them when profile preferences/custom items change.
- Snapshot preset item content into the trip at contribution time. Later admin edits affect new contributions, not existing trips.
- Return ordered display groups from the trip endpoint and keep item IDs stable for packed-state checks.
- Support both PostgreSQL and Firestore adapters; the memory adapter follows the PostgreSQL implementation today and must remain testable.

## 1. Verified current architecture and constraints

Relevant current code:

- Database facade/provider selection: `server/src/db.ts`, `server/src/db.providers.ts`.
- PostgreSQL schema and packing functions: `server/src/db.postgres.ts`.
- Firestore implementation: `server/src/db.firebase.ts`.
- Existing routes: `server/src/routes/tripRoutes.ts`, `server/src/routes/accountRoutes.ts`, `server/src/routes/adminRoutes.ts`.
- Existing types: `server/src/types.ts` (`PackingListItem`, `PackingListTraveler`, `TripPackingList`).
- Current default data: `server/src/config/defaultPackingList.ts`.
- Current UI: `app/components/PackingListTable.tsx`, account packing-list UI in `app/tabs/account.tsx`, admin default UI in `app/tabs/AdminTab.tsx`.
- Existing tests: `server/__tests__/packing-list.test.ts`, `server/__tests__/packing-list-migration.test.ts`, `app/tests/packingListTable.test.tsx`, `app/tests/accountPackingList.test.tsx`.

Repository constraints that affect the design:

- New database operations must be implemented in PostgreSQL and Firestore, with facade exports in `db.ts`.
- Server builds already copy `server/data` to `server/dist/data` through `server/scripts/copy-runtime-assets.js`; the new markdown directory will be included automatically, but a build assertion should verify it.
- Startup currently calls `initDb()` before background catalog work such as the attractions sync. Preset sync should run after `initDb()` and be awaited in non-background/test mode so a bad seed cannot silently produce an incomplete catalog.
- The current user list cannot be empty (`replaceUserPackingList` rejects empty input). V2 must allow an empty personal list because General is no longer copied into every user's custom list.

## 2. Functional requirements and acceptance criteria

### 2.1 Preset catalog

Ship these required presets:

| Key | Label | Purpose |
| --- | --- | --- |
| `general` | General | Universal essentials; baseline for every traveler/trip |
| `men` | Men | Optional men's clothing, grooming, and accessories |
| `women` | Women | Optional women's clothing, grooming, and accessories |
| `hiking` | Hiking & Trekking | Trail clothing, navigation, hydration, and safety |
| `camping` | Camping | Shelter, sleep system, camp kitchen, and campsite gear |
| `cruise` | Cruise | Cabin, embarkation, formal-night, and shore-excursion items |
| `beach` | Beach & Tropical | Swim, sand, water, and tropical-weather items |

Also seed these expert-recommended additions:

`winter_ski` (Winter & Ski), `business` (Business Travel), `international` (International Travel), `road_trip` (Road Trip), `formal_event` (Formal Event & Wedding), `family_kids` (Family with Kids), `pet_travel` (Traveling with a Pet), `backpacking` (Backpacking / Ultralight), `city_sightseeing` (City Sightseeing), `photography` (Photography Gear), `tropical` (Tropical & Island), `hostel` (Hostel Stay), `digital_nomad` (Work from Anywhere), `baby_toddler` (Infant & Toddler Essentials), `diving` (Scuba & Snorkel), `yoga_retreat` (Yoga & Wellness), `festival` (Music Festival), and `safari` (Wildlife Safari).

The catalog must be data-driven: adding a valid markdown file adds a selectable preset after the next catalog sync; no application release should be needed for a new admin-uploaded list.

### 2.2 General non-overlap

No non-General preset may contain an item whose normalized label exactly matches an item in General. Normalization is Unicode-aware lowercase, trim, and collapse internal whitespace; punctuation and quantity suffixes should be normalized consistently by one shared helper. The rule is enforced as follows:

- Seed sync rejects that file and retains the previous DB version.
- Admin upload returns a validation error identifying each collision; it does not partially create the list.
- CI/parser tests validate every checked-in preset against General.
- Semantic near-duplicates such as `sunscreen` and `reef-safe sunscreen` are a content-review concern, not an automatic equality rule. Avoid them in the supplied catalog where practical.

The markdown files must state that General is included separately and must not be repeated.

### 2.3 Profile preferences and personal items

- Each user has a set of preferred preset keys. `general` is inserted by default and cannot be removed.
- A user may select or deselect any other active preset.
- Each user has one editable personal custom list, which may be empty. It is not a preset and is never shared with other profiles.
- Profile UI must explain that selected presets and personal items are contributed to trips on which the user is an active traveler.
- Profile changes reconcile that user's profile-derived contributions on active trips. Removing a preference removes only that user's source; shared/manual items remain. Updating personal items removes/replaces only that user's personal contribution.
- Gendered lists are opt-in; do not infer a list from account name, gender, pronouns, or profile data. Labels should remain editable in future catalog versions.

### 2.4 Trip composition and membership lifecycle

On trip creation or traveler activation, materialize:

1. General once for the trip, even if multiple travelers prefer it.
2. The union of every active traveler's selected preset lists.
3. Each active traveler's personal custom list.
4. Trip-level preset lists and manual items explicitly added by travelers.

When a traveler is added or an invitation is accepted, add profile-derived preset and personal contributions from the current profile snapshot. A guest without a user account contributes no profile/personal items; General remains available as the trip baseline.

When a traveler is removed, retract only that member's `profile_preset` and `profile_personal` contributions across all trips in the group. Do not retract:

- another traveler's profile-derived contribution;
- a trip-level preset manually added to the trip;
- a manually entered trip item; or
- a legacy item preserved by migration.

When a trip-level preset is added directly, it becomes trip-owned and remains until explicitly removed from that trip. The identity of the actor is retained for audit/history, but membership removal must not delete it.

Shared labels are represented by one trip item. Removing one source deletes the item only when no sources remain and it is not a legacy/manual item. If the winning display source is removed, the transaction recomputes the item's display group/category from the remaining source with the highest display precedence.

### 2.5 Display order and deduplication

Render one screen with separators for these groups:

1. General.
2. Women.
3. Men.
4. Trip-specific presets, in the order they were added to the trip; repeated presets are shown once.
5. Trip additions (manual items and manually added preset items that do not already belong to a higher group).
6. Multiple Travelers (items appearing in personal lists of two or more travelers).
7. Personal items, one group per traveler, with the current traveler first and the rest alphabetical.

The explicit Trip additions group is a recommendation to preserve manual items without inventing a catalog key. It may be renamed to “Trip custom” in the UI.

Walk groups in this order, maintaining a set of normalized item labels. Suppress a later item if its normalized label was already displayed. Suppress any group whose remaining item set is empty, including its separator/title. This rule applies to all groups, including personal and manual groups.

The server should return `groups` with `items` already ordered and deduplicated. Keep a compatibility `items` array during rollout if existing clients still consume it; mark it deprecated and remove it after the client migration.

### 2.6 Table behavior

- Freeze the header row containing `Item` and traveler names while the vertical list scrolls.
- Freeze the left-most item-name column while the horizontal traveler matrix scrolls.
- Put the current logged-in traveler in the first traveler column (the second table column overall), followed by all other active travelers alphabetically by display name. Use a stable member ID as the tie-breaker.
- If the viewer is not a traveler, show all travelers alphabetically.
- Preserve per-item/per-traveler packed checks while groups are deduplicated; the canonical item row owns the check state.
- On web, use CSS sticky positioning (`position: sticky`) with explicit z-index/backgrounds and a table width that supports horizontal scrolling.
- On native, implement a custom matrix view using synchronized `ScrollView` components. A frozen left column (vertical `ScrollView`) will display item names, while the main content area (bi-directional `ScrollView` or nested `ScrollView`s) will display the check matrix. Vertical scroll events from either the labels or the matrix must be synchronized to ensure a smooth "frozen pane" experience.
- Category rows are separators and must not become traveler check columns.

## 3. Data model

Use relational tables in PostgreSQL and equivalent Firestore collections/documents. Names below are logical; follow the repository's existing snake_case/camelCase conventions per adapter.

### 3.1 Catalog and profile tables

```text
preset_packing_lists
  id, key unique, label, description, gendered,
  source ('seed' | 'admin_upload'), content_hash,
  removed_at, created_by_admin_id, created_at, updated_at

preset_packing_list_items
  id, preset_list_id, category, label, normalized_label, position,
  created_at, updated_at
  unique (preset_list_id, normalized_label)

user_packing_list_preferences
  user_id, preset_list_id, created_at, updated_at
  primary key (user_id, preset_list_id)

user_packing_list_items
  existing table, redefined as personal-only items;
  allow zero rows, retain category/label/position editing
```

Do not use a hard foreign-key cascade from a preset deletion to historical trip sources. A removed preset disappears from future selection but remains resolvable for historical provenance.

### 3.2 Trip contributions and items

```text
trip_packing_contributions
  id, trip_id, group_member_id nullable, preset_list_id nullable,
  source_kind ('profile_preset' | 'profile_personal' |
               'trip_preset' | 'trip_manual' | 'legacy_manual'),
  created_by_user_id nullable, created_at, removed_at nullable

trip_packing_list_items
  id, trip_id, category, label, normalized_label, position,
  winning_source_id, created_at, updated_at
  unique (trip_id, normalized_label)

trip_packing_item_sources
  item_id, contribution_id, source_category, source_position,
  created_at
  primary key (item_id, contribution_id)

trip_packing_item_checks
  existing table; item IDs remain stable while at least one source remains
```

Contribution records are the important distinction:

- `profile_preset` is tied to one active `group_member_id` and one preset.
- `profile_personal` is tied to one active member and the user's personal-list snapshot.
- `trip_preset` is trip-owned, optionally records who added it, and survives member removal.
- `trip_manual` is trip-owned and survives member removal.
- `legacy_manual` protects pre-V2 snapshot rows during migration.

The item source link allows one item to have multiple contributors. Each source stores the category/position used when it was materialized so removing a higher-priority source can select the next source deterministically. Source precedence is `general`, `women`, `men`, trip-preset insertion order, trip-manual, then personal traveler order.

For Firestore, use trip subcollections for contributions, items, sources, and checks, with bounded batch writes. If Firestore cannot enforce the relational uniqueness constraints, enforce normalized-label idempotency in a transaction and cover concurrent additions with emulator tests.

## 4. Synchronization and transaction rules

### 4.1 Composition and deduplication algorithm

When materializing the trip packing list for display or persistent sync, the system follows this precedence to ensure each normalized item label appears exactly once:

1. **Initialize** an empty `displayedItems` set and an empty `orderedGroups` list.
2. **Collect and count all sources** for the trip. For items derived from `profile_personal` contributions, count how many distinct travelers contribute each unique `normalized_label`.
3. **Assign items to display groups** based on category precedence:
   - `general`
   - `women`
   - `men`
   - `trip_preset` (in order of addition to trip)
   - `trip_manual` / `legacy_manual`
   - `multiple_travelers` (items appearing in 2+ personal lists)
   - `profile_personal` (Current User first, then others alphabetically)
4. **Iterate** through the sorted categories:
   - For each category:
     - Filter items that belong to this category from all active contributions.
     - For each item:
       - If `normalized_label` is already in `displayedItems`, **skip**.
       - If the item is in a personal list and its count is 2+, it belongs in `multiple_travelers`.
       - Otherwise, add `normalized_label` to `displayedItems` and add the item to the current group.
     - If the group has items, add it to `orderedGroups` with its category title.
5. **Return** `orderedGroups` to the client.

This ensures that if "Sunscreen" is in the `general` list, it will not appear in the `beach` list or a user's `personal` list, even if it was contributed by those sources.

### 4.2 Atomic operations

- `reconcileUserPackingPreferences(userId)` — updates the user's profile selections and reconciles their profile contributions on active trips.
- `addMemberPackingContributions(tripId, memberId)` — reads the current profile and adds profile preset/personal contribution records.
- `removeMemberPackingContributions(memberId)` — removes only profile-derived contributions and garbage-collects unreferenced non-manual items.
- `addTripPreset(tripId, presetKey, actorMemberId)` — creates one trip-owned `trip_preset` contribution and materializes its items.
- `removeTripPreset(tripId, presetKey)` — marks/removes the trip-owned contribution after authorization; other sources remain.
- `addTripManualItem` / `removeTripManualItem` — creates/removes trip-owned manual contributions.
- `recomputeWinningSources(tripId, itemIds)` — updates display metadata after source changes.

Idempotency is required for invite retries, duplicate membership events, and page refreshes. Use deterministic contribution keys such as `(trip_id, member_id, source_kind, preset_id)` or an equivalent Firestore document ID. All source reconciliation and item cleanup must happen in one database transaction/batch where the provider supports it.

Preset content is snapshotted into trip sources. Admin editing/removing a preset does not rewrite existing trip items. A profile preference change is different: it deliberately removes and re-materializes that user's profile contribution so the current profile is reflected on active trips.

## 5. Markdown catalog and deploy synchronization

### 5.1 File contract

Each checked-in preset is one file at `server/data/packing_lists/<key>.md`:

```markdown
---
key: beach
label: Beach & Tropical
description: Swim, sand, and warm-weather gear.
gendered: false
---

<!-- General is included separately; do not repeat General items. -->

## Clothing
- Swimsuit
- Cover-up / sarong
```

Required parser rules:

- UTF-8, frontmatter delimited by `---`.
- `key` must be a lowercase slug and match the filename.
- `label` is required; `description` and `gendered` are optional with safe defaults.
- `##` headings become item categories; `- ` lines become ordered items.
- Reject empty labels, duplicate normalized labels within one preset, unknown required frontmatter types, and General collisions.
- Ignore HTML comments and blank lines; do not execute or render arbitrary markdown.
- Limit upload size, item count, label length, and category length.

Implement parsing and validation in `server/src/services/packingListCatalogService.ts` with no dependency on the UI or a full markdown renderer. Reuse the same parser for checked-in files and admin uploads.

### 5.2 Seed sync

Add `syncPackingListCatalogFromDisk()` after `initDb()` in `server/src/index.ts`:

- Read only `server/data/packing_lists` resolved from the runtime directory.
- Parse and validate the complete seed set before changing the DB.
- Upsert seed-owned rows by key and replace their items only when `content_hash` changes.
- Never overwrite a row whose source is `admin_upload`; require an explicit admin action to replace it.
- Soft-remove seed-owned rows whose files were removed from the repository; do not touch admin-uploaded rows or existing trip snapshots.
- In production, log and fail the startup/deploy health check on invalid seed content rather than serving a silently incomplete catalog. In tests, make sync awaitable and surface the error.
- Invalidate the in-process catalog cache after a successful sync or admin mutation.

The existing server build copies `server/data` into `server/dist/data`; add a build/test assertion that all expected preset files are present in the runtime path.

### 5.3 Admin console

Add a “Packing List Presets” section to `AdminTab`:

- List active and removed presets with label, key, source, item count, and updated time.
- Upload a new `.md` through `POST /api/admin/packing-list-presets` as raw text or multipart content. Parse/validate on the server; do not write uploads to the container filesystem.
- Reject key collisions by default. An explicit replace action may transfer ownership of a seed key to an admin-uploaded version after confirmation; preserve historical snapshots.
- Allow item editing through a structured API, not by rewriting markdown on the server.
- Remove/reactivate presets with audited soft-delete actions. Never allow deletion of `general`.
- Record actor, key, source, before/after content hash, and reason in the existing audit-log mechanism.

## 6. API surface

Proposed endpoints (exact route naming should follow existing auth middleware conventions):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/packing-list-presets` | Active catalog for profile/trip selection |
| GET | `/api/account/packing-list-presets` | Current user's selected keys |
| PUT | `/api/account/packing-list-presets` | Replace selected keys; always retain General |
| GET/PUT | `/api/account/packing-list` | Read/replace personal-only items; allow empty |
| POST | `/api/trips/:id/packing-list/presets/:key` | Add trip-owned preset |
| DELETE | `/api/trips/:id/packing-list/presets/:key` | Remove trip-owned preset added to this trip |
| POST/DELETE | `/api/trips/:id/packing-list/items` | Add/remove trip-owned manual items |
| GET | `/api/trips/:id/packing-list` | Ordered groups, travelers, and packed state |
| PATCH | `/api/trips/:id/packing-list/checks` | Existing packed-state operation |
| POST | `/api/admin/packing-list-presets` | Validate and upload a preset |
| PUT | `/api/admin/packing-list-presets/:id` | Admin metadata update or explicit replacement |
| PUT | `/api/admin/packing-list-presets/:id/items` | Structured item edit |
| DELETE | `/api/admin/packing-list-presets/:id` | Audited soft remove |

Trip mutations must authorize an active traveler or existing trip editor according to the app's current permissions. The server must never trust a client-provided `group_member_id` without verifying membership in that trip.

Suggested trip response:

```json
{
  "travelers": [{ "id": "...", "userId": "...", "name": "...", "email": "..." }],
  "groups": [
    { "key": "general", "label": "General", "kind": "preset", "items": [] },
    { "key": "personal:<memberId>", "label": "Alex's personal list", "kind": "personal", "ownerMemberId": "...", "items": [] }
  ]
}
```

Items include `id`, `category`, `label`, `position`, and `packedBy`. During rollout, optionally include a flattened `items` field for older clients, but make `groups` authoritative.

## 7. Migration and rollout

Create an additive migration and paired rollback, following repository naming/drift-guard conventions.

1. Add catalog, preference, contribution, source, normalized-label, and display-source fields/tables.
2. Seed all current users with the General preference.
3. Convert existing `user_packing_list_items` carefully: current users contain copied universal defaults, so exact matches to the current universal list should not remain personal items. Preserve non-matching/edited rows as personal items. Permit an empty personal list.
4. For existing trip rows, create `legacy_manual` contributions/sources. This prevents membership removal from deleting historical snapshot content and preserves existing packed checks.
5. Resolve any pre-existing duplicate normalized labels per trip deterministically, migrate checks to the retained canonical item, and record the migration count for review.
6. New trips created after the feature flag uses V2 composition. Existing trips can be opted into reconciliation only after the backfill is verified; do not silently replace their historical snapshots.
7. Roll out behind `packing_lists_v2`: first catalog/admin validation, then profile preferences, then trip composition/display. Keep the V1 read path available for rollback until V2 health metrics are stable.

Rollback must not delete catalog or provenance data. Disable V2 reads/writes and retain additive tables for a later retry. Test migration and rollback against both PostgreSQL/pg-mem and Firestore emulator fixtures.

## 8. Performance, usability, and maintenance

- Cache the small active catalog in-process with explicit invalidation after sync/admin writes. Do not query every preset item on every profile render.
- Use batched/transactional writes for one contribution; expected scale is tens of items per preset and low hundreds per trip.
- Index trip contributions by `(trip_id, source_kind, group_member_id)`, trip items by `(trip_id, normalized_label)`, preset items by `(preset_list_id, position)`, and preferences by `(user_id, preset_list_id)`.
- Make source reconciliation idempotent and avoid an O(trip-size) scan when adding a member; cleanup may scan only affected item IDs.
- Keep the display deduplication pure and linear in the returned item count. Do it server-side for consistent clients, with a client unit-testable helper as a defense-in-depth check.
- Virtualize or incrementally render unusually large matrices; avoid re-rendering every traveler cell on a single check toggle.
- Give profile users a searchable multi-select, clear “General is required” help text, and a preview of the personal list. On trips, clearly distinguish “from profile,” “added to trip,” and “personal” without exposing internal IDs.
- Make removal actions reversible where possible and show whether an item remains because another traveler or the trip itself still contributes it.
- Treat uploaded markdown as untrusted input: size limits, schema validation, authorization, audit logging, and no filesystem writes.
- Add catalog validation to CI so content quality is maintained by ordinary code review. Keep the markdown files readable and travel-agent reviewed.

## 9. Test plan — combine with existing packing-list coverage

Extend the existing tests rather than creating a parallel legacy suite.

### Server integration and unit tests

Extend `server/__tests__/packing-list.test.ts` to cover:

- General is present by default and cannot be removed from profile preferences.
- Profile preset selection and personal-list edits reconcile active trips.
- Multiple travelers' preset/personal contributions merge into one trip.
- Adding/removing a traveler retracts only that member's profile sources.
- Shared labels survive removal of one source; manual trip items and trip-owned presets survive member removal.
- Removing a trip-owned preset retracts only that preset's sources.
- Exact normalized duplicate labels are represented once, with deterministic winning group/order.
- Personal lists for different travelers are deduplicated into a "Multiple Travelers" section if an item appears in 2+ personal lists.
- Items in "Multiple Travelers" appear before individual personal lists but after trip presets/additions.
- General → Women → Men → trip-specific → trip additions → multiple travelers → personal ordering.
- Empty groups are omitted after deduplication.
- Current traveler-first and alphabetical fallback traveler ordering.
- Packed checks remain correct after source deduplication and source removal.
- Guest/pending member behavior is safe and idempotent.

Extend `server/__tests__/packing-list-migration.test.ts` to assert General preference seeding, personal-list conversion, legacy contribution preservation, duplicate-label handling, and rollback safety.

Add `server/__tests__/packing-list-catalog.test.ts` for parser/schema errors, filename/key mismatch, duplicate labels, General collisions, seed sync hashing, seed-file deletion soft-removal, admin-owned row protection, and runtime asset copying.

Add/extend admin route tests for upload limits, malformed markdown, key collision, General protection, soft removal/reactivation, structured item edits, authorization, and audit records.

Run equivalent composition and cleanup tests through the Firestore emulator. The memory adapter must exercise the same public facade methods used by route tests.

### App tests

Extend `app/tests/packingListTable.test.tsx` for group separators, deduplication, empty-group suppression, traveler order, current-user-first behavior, check toggling, and sticky style/z-index contracts on web. Add `app/tests/packingListDisplay.test.ts` for the pure grouping function.

Extend `app/tests/accountPackingList.test.tsx` for preset multi-select, required General, empty personal-list editing, save failures, and profile reconciliation feedback. Add admin tests for upload, validation errors, list removal, reactivation, and item editing.

Add one end-to-end flow: configure two profiles, create a trip, verify merged groups and deduplication, add a trip-owned preset, remove a traveler, and verify only profile-derived content retracts.

## 10. Implementation sequence

1. Add pure normalization, markdown parser, catalog content, and parser/content tests.
2. Add schema/migrations and adapter-level catalog/preferences/provenance operations.
3. Implement composition/reconciliation service and wire trip membership/invite lifecycle events.
4. Add catalog/profile/trip/admin endpoints and authorization/audit logging.
5. Update account/admin/trip UI and response types; implement web sticky matrix first and native fallback deliberately.
6. Backfill in a test environment, run combined PostgreSQL/pg-mem/Firestore tests, and verify `server/dist/data/packing_lists` after build.
7. Enable the feature flag for canary accounts, inspect reconciliation/error/latency metrics, then roll out.

## 11. Decisions recommended before implementation

The plan uses these defaults unless product direction changes them:

- Trip-owned manually added presets survive the actor leaving the trip; only an explicit remove retracts them.
- Profile preference and personal-list edits reconcile the user's active trips.
- General is mandatory, while Men/Women and all other presets are opt-in.
- Exact normalized General collisions are rejected; near-duplicates are reviewed by content owners.
- Existing trip snapshots are preserved as legacy/manual during migration rather than unexpectedly rewritten.
- Manual trip items display in a dedicated “Trip additions” separator between trip presets and personal groups.

The two product questions worth confirming are whether profile edits should affect already-created active trips immediately (the recommended default above), and whether manual trip additions should be visible under a dedicated “Trip additions” separator or under a user-selected trip preset. Neither choice changes the core provenance model.
