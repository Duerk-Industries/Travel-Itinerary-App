# Packing Lists v2 — Phased Implementation Plan

Source spec: `docs/packing-lists-v2-plan.md` (the repository's requirements document; `docs/packing-lists-v2.md` was referenced by the request but does not exist). It is authoritative for data model, algorithms, API shapes, and acceptance criteria — this document sequences and operationalizes that work. Section references below (e.g. "§2.5") point into the source spec.

Audience: an LLM coding agent implementing this feature phase by phase. Each phase is scoped to be one PR: it should leave `main`/the feature branch **buildable and green** (`npm test` passing in both `app/` and `server/`) before moving to the next phase. Do not start a phase until the previous phase's Definition of Done is met. Within a phase, prefer small commits over one giant diff.

General rules for every phase:
- Follow CLAUDE.md conventions: new DB functions implemented in both `db.postgres.ts` and `db.firebase.ts`, env vars only via `getEnvValue()`/`getEnvFlag()`, logging via `logInfo`/`logError`, no direct `process.env` access in routes/services.
- Every phase that adds server behavior needs corresponding tests in the same PR — do not defer tests to a later "testing phase." (Phase 9 is E2E + rollout hardening only, not first-time unit coverage.)
- Gate all new user/trip-visible behavior behind the `packing_lists_v2` feature flag from the start (add it to `server/config/feature-flags.yaml` in Phase 1), even while most of it is unreachable — this avoids a risky flip-the-switch PR at the end.

---

## Phase 0 — Pure logic, no DB, no routes

**Goal:** land all the framework-independent logic first, since it's the highest-leverage, lowest-risk code and unblocks parser/content authoring in parallel with schema work.

**Build:**
- `packages/domain/src/packingListNormalize.ts` — the canonical label-normalization helper (Unicode-aware lowercase, trim, collapse whitespace), re-exported to the app and mirrored under `server/src/utils/packingListNormalize.ts` because of the server `rootDir`; it is used by both catalog parsing (General-collision checks, §2.2) and trip-item dedup (§2.5).
- `server/src/services/packingListCatalogService.ts` — markdown **parsing and validation only** at this stage (no DB calls yet): frontmatter parsing, `##`/`- ` extraction, filename/key match check, duplicate-label-within-file check, General-collision check (§5.1). Export pure functions: `parsePresetMarkdown(raw: string, filename: string): ParsedPreset | ParseError`.
- `server/data/packing_lists/general.md` plus every checked-in preset (currently 25 files: 7 required, 9 recommended in §2.1, and 9 additional repository presets). Author real content as an expert-travel-agent pass; every non-General file must pass the General-collision check against `general.md`.
- Display composition as a **pure shared function** in `packages/domain/src/packingListDisplay.ts`, re-exported from `packages/domain/src/index.ts` and `app/utils/packingListDisplay.ts`. Add the repository-standard mirror at `server/src/utils/packingListDisplay.ts` because the server compiler's `rootDir` is `server/src`; add a parity test like the existing domain-sync tests so the server cannot drift from the canonical algorithm. This keeps the server response authoritative without an untested second algorithm. It implements the precedence/dedup/empty-group-suppression algorithm in §2.5 (including the "Multiple Travelers" section for items appearing in 2+ personal lists, §4.1) against an in-memory fixture shape, not real DB rows yet.

**Tests:**
- `server/__tests__/packing-list-catalog.test.ts` (new): parser success/error cases, General-collision detection, and every checked-in file individually validates. The test must enumerate the directory rather than hard-code 16 files.
- `server/__tests__/packingListNormalize.test.ts` (new): normalization edge cases (Unicode, punctuation, whitespace) and canonical/server mirror parity; add the equivalent app re-export test where needed.
- `server/__tests__/packingListDisplay.test.ts` (new): ordering, dedup, empty-group suppression, and personal-group ordering — using the fixture shapes from §2.5, independent of any route.
- Extend the existing domain-sync test to compare the canonical package and server mirror; add `app/tests/packingListDisplay.test.tsx` to verify the app re-export/response contract without introducing a third algorithm.

**Definition of Done:** all new tests pass; no DB schema, route, or UI touched; `npm test` green in both packages.

**Current content preflight:** the repository currently has exact General collisions in `digital_nomad.md` (`universal travel adapter`) and `hostel.md` (`eye mask`, `universal travel adapter`). Those content files must be corrected before catalog sync can satisfy §2.2 and before this phase is complete.

---

## Phase 1 — Schema and migrations

**Goal:** land the additive schema so later phases have tables to write to. No behavior changes yet.

**Build:**
- Postgres migration `server/migrations/<date>_packing_lists_v2_schema.sql` + `.rollback.sql`: `preset_packing_lists`, `preset_packing_list_items`, `user_packing_list_preferences`, `trip_packing_contributions`, `trip_packing_item_sources` (§3.1–3.2), plus `ALTER TABLE trip_packing_list_items ADD COLUMN normalized_label, winning_source_id`.
- Give each contribution a non-null deterministic `contribution_key` with a unique constraint (for example, profile preset = trip/member/preset, profile personal = trip/member/personal, trip preset = trip/preset, manual = contribution ID). Do not rely on a nullable multi-column unique constraint for idempotency.
- Explicitly remove the old unique constraint/index on `(trip_id, category, label)` and add the unique `(trip_id, normalized_label)` constraint after the duplicate-label backfill step; do not leave both uniqueness rules in place.
- Add migration backup tables (or an equivalent durable backup record) for user rows removed during personal-list conversion and trip rows merged during duplicate normalization. Rollback must be able to restore data, not merely drop the new tables.
- Update `server/src/db.postgres.ts` schema-init block with the new tables/indexes (§8's index list: `(trip_id, source_kind, group_member_id)`, `(trip_id, normalized_label)`, `(preset_list_id, position)`, `(user_id, preset_list_id)`).
- Add `packing_lists_v2` entry to `server/config/feature-flags.yaml` (default off).
- Firestore: document the intended collection shape in a comment block in `db.firebase.ts` near the existing packing-list functions; do not implement adapter methods yet (that's Phase 3) — this phase is schema/migration only.
- Extend `server/__tests__/migrationDriftGuard.test.ts` coverage (it should pick the new migration up automatically if it follows repo conventions — verify, don't reinvent).

**Tests:**
- Migration applies and rolls back cleanly against pg-mem and a real local Postgres if available.
- Drift guard passes.

**Definition of Done:** schema exists, migration+rollback both tested, no application code reads/writes the new tables yet, existing packing-list tests still pass unmodified.

---

## Phase 2 — Catalog DB sync

**Goal:** make the preset catalog live in the database, seeded from the Phase 0 markdown files, before anything depends on it.

**Build:**
- Extend `packingListCatalogService.ts` with `syncPackingListCatalogFromDisk()`: content-hash upsert of seed-owned rows, never overwrites `admin_upload`-sourced rows, soft-removes seed rows whose files disappeared (§5.2).
- Wire into `server/src/index.ts` after `initDb()`, following the `attractionsCatalogService.ts` pattern (§1 constraint: awaited in test/non-background mode).
- In-process catalog cache with invalidation hook (§8) — expose `getActivePresetCatalog()` for later phases to consume.
- Build assertion that `server/data/packing_lists` survives the `copy-runtime-assets.js` step into `server/dist/data`.

**Tests:**
- Extend `packing-list-catalog.test.ts`: seed upsert, content-hash skip-if-unchanged, admin-row protection, soft-removal on file deletion, cache invalidation.
- Startup sync runs cleanly in the server test bootstrap without needing `packing_lists_v2` enabled (this is DB seeding, not user-facing behavior).

**Definition of Done:** `preset_packing_lists`/`preset_packing_list_items` are populated end-to-end from disk in tests; no route or UI exposes them yet.

---

## Phase 3 — Adapter-level data operations

**Goal:** implement every DB operation from §4 (Synchronization and transaction rules) in both adapters, fully unit-testable via direct function calls (no HTTP yet).

**Build, in `db.postgres.ts` (source of truth for the `DatabaseAdapter` type) then mirrored in `db.firebase.ts`:**
- `listActivePackingPresets()` / `getPackingPresetByKey(key)`
- `getUserPackingPreferences(userId)` / `reconcileUserPackingPreferences(userId, selectedKeys)`
- `reconcileUserPersonalPackingList(userId)` — called after the existing personal-list replacement endpoint, not only after preset preference changes
- `addMemberPackingContributions(tripId, memberId)`
- `removeMemberPackingContributions(memberId)`
- `addTripPreset(tripId, presetKey, actorMemberId)`
- `removeTripPreset(tripId, presetKey)`
- `addTripManualItem` / `removeTripManualItem`
- `recomputeWinningSources(tripId, itemIds)`
- `getTripPackingListGroups(tripId, viewerUserId)` — assembles raw contributions/items/sources, calculates traveler contribution counts for personal items to identify shared entries (§4.1), and calls the Phase 0 pure display function to return ordered groups (§2.5, §4.1).
- Catalog/admin operations: `createUploadedPreset`, `updatePresetMetadata`, `replacePresetItems`, `softRemovePreset`, and `reactivatePreset`, with cache invalidation and audit payloads.
- Facade exports in `db.ts`.
- Idempotency via the non-null deterministic `contribution_key` from Phase 1 (§4) — use `ON CONFLICT DO NOTHING`-style upserts on Postgres; note the pg-mem caveat from existing memory notes (`ON CONFLICT DO NOTHING` with `INSERT...SELECT` isn't supported — use the loop/try-catch pattern already established in this codebase).

**Tests:**
- Extend `server/__tests__/packing-list.test.ts` with adapter-level tests (call the functions directly, not via HTTP) for every scenario in the spec's §9 server test list: multi-traveler merge, add/remove retraction scoping, shared-label survival, manual/trip-preset survival even when unshared, dedup determinism, guest/pending-member safety, profile personal-list reconciliation, and General-only guest behavior.
- Run the same scenarios against the memory adapter (inherits via spread — verify no gaps) and Firestore emulator if one is configured in this repo; if no emulator harness exists yet, flag that as a prerequisite rather than skipping Firestore correctness silently.

**Definition of Done:** every function in §4 has adapter-level test coverage in Postgres/memory (and Firestore if emulator available); still no public route.

---

## Phase 4 — Migration execution and legacy backfill

**Goal:** run the actual data migration for existing users/trips now that the target schema and adapter logic both exist, so it can be tested against realistic pre-existing data before any route depends on it.

**Build:**
- Data-migration script/SQL per §7 steps 2–5: seed `general` preference for all existing users; convert `user_packing_list_items` (drop exact-match-to-universal-defaults rows, preserve edited/custom rows, allow resulting empty list); create `legacy_manual` contributions/sources for existing trip items; resolve pre-existing duplicate normalized labels deterministically and remap checks to the canonical item.
- Run the duplicate-label collapse before creating the new normalized-label unique constraint. Preserve the old category/label and item/check mapping in the migration backup record.
- Implement an equivalent Firestore backfill script using batched writes and an idempotent marker/version; SQL rollback alone cannot cover the Firestore provider.
- Log a migration summary count (rows converted, duplicates resolved, checks remapped, backups created) for manual review, per §7 step 5.

**Tests:**
- Extend `server/__tests__/packing-list-migration.test.ts`: General preference seeding, personal-list conversion (both the "was pure universal copy" and "was edited" cases), legacy contribution preservation, duplicate-label resolution + check remapping, rollback safety.

**Definition of Done:** migration is idempotent, tested against a realistic pre-v2 fixture (reuse/extend the existing migration test's seed data rather than inventing new fixtures), backup-assisted rollback restores the pre-migration state, and the Firestore backfill can resume safely after interruption.

---

## Phase 5 — API routes

**Goal:** expose Phase 3's adapter functions over HTTP, behind the `packing_lists_v2` flag, with authorization.

**Build (§6 table):**
- `GET /api/packing-list-presets`
- `GET` and `PUT /api/account/packing-list-presets`
- `GET` and `PUT /api/account/packing-list` (when V2 is enabled, relax the existing "cannot be empty" validation because the list is personal-only; preserve the V1 behavior while the flag is off)
- After either profile preference changes or personal-list replacement, reconcile all active trips for that user's profile-derived contributions. Return a clear success/error state so the UI does not imply that a trip changed when reconciliation failed.
- `POST` and `DELETE /api/trips/:id/packing-list/presets/:key`
- `POST` and `DELETE /api/trips/:id/packing-list/items`
- `GET /api/trips/:id/packing-list` — changed response shape (`groups` + `travelers`, §6 sample JSON); keep a flattened `items` compatibility field during rollout per §2.5/§6.
- Admin: `POST`, `PUT`, and `DELETE /api/admin/packing-list-presets[...]` including the structured item-edit endpoint and audited soft-remove; add an explicit reactivation operation; block removal of `general` (§5.3). Uploads are parsed in memory and never written to the container filesystem.
- Every trip-scoped route verifies the caller is an active member of that trip's group — never trust a client-supplied `group_member_id` (§6 closing note).
- Wire every membership lifecycle path, including trip creation with initial members, direct group-member add/un-remove, invite acceptance, and member removal, to `addMemberPackingContributions` / `removeMemberPackingContributions` (§2.4). The existing mutations live partly in database functions, not only route files; hook at the transaction boundary and do not duplicate membership logic.

**Tests:**
- `supertest` route tests for every new/changed endpoint: success paths, authorization failures (non-member trying to mutate a trip), General-protection on admin delete, explicit reactivation, audit-log entries written, profile-edit reconciliation, and flag-off behavior (v1 endpoints still work unchanged when `packing_lists_v2` is off).

**Definition of Done:** full API surface from §6 implemented and tested; feature flag still defaults off so v1 behavior is unaffected for existing users.

---

## Phase 6 — Frontend: account and admin UI

**Goal:** ship the profile and admin surfaces, since they're simpler than the trip matrix and validate the API end-to-end first.

**Build:**
- `app/tabs/account.tsx`: preset multi-select (General shown as required/non-removable), personal list editor updated to allow empty, save-failure/reconciliation feedback, and a clear indication that selected presets/personal items flow to active trips (§2.3, §9).
- `app/tabs/AdminTab.tsx`: new "Packing List Presets" section — list (active + removed, source badge), upload `.md` via file picker → `POST`, structured item editing (reuse existing admin table editing pattern), remove/reactivate, all behind existing admin-only visibility gate.

**Tests:**
- Extend `app/tests/accountPackingList.test.tsx`: multi-select, required General, empty personal-list save, reconciliation feedback.
- New admin UI tests: upload success/validation-error display, remove/reactivate, item edit.

**Definition of Done:** a real user/admin can exercise the full preference/catalog-management loop through the UI with the flag on in a dev environment; verify manually per the `run`/`verify` skills before marking done, not just via unit tests.

---

## Phase 7 — Frontend: trip packing list (web)

**Goal:** the trip-facing matrix — the most visually complex piece — built web-first per the earlier native-vs-web decision.

**Build:**
- Rewrite `app/components/PackingListTable.tsx` trip-list rendering to consume the `groups` response shape: General, Women, Men, trip-specific presets, Trip additions, Multiple Travelers (shared personal items), and one personal group per traveler; suppress groups that are empty after deduplication (§2.5, §4.1).
- Web sticky header row + sticky first column via `toWebStyle()`/CSS `position: sticky` (§2.6).
- Traveler column ordering: current user first, others alphabetical by display name with member-ID tiebreak (§2.6). Personal group ordering must use this same order: current traveler's personal group first, then the remaining travelers alphabetically.
- Add/remove trip preset and manual-item UI affordances on the trip screen. A trip-owned preset must remain after the traveler who added it leaves, even when no other traveler selected it.
- Scope re-renders to the toggled cell/row on check-state changes (§8 performance note) — check whether the current component already does this; fix if not, since it matters more once lists are larger.

**Tests:**
- Extend `app/tests/packingListTable.test.tsx`: exact group order, dedup, empty-group suppression, correct handling of the Multiple Travelers group, traveler ordering, check toggling, sticky style contract (web), and manual/trip-preset controls.

**Definition of Done:** trip packing list fully functional on web with the flag on; manually verified in a browser per the `run` skill (add/remove traveler, add/remove trip preset, check toggling, scroll behavior with a large list).

---

## Phase 8 — Native frozen-pane matrix

**Goal:** native parity for the trip matrix, deliberately sequenced after web is proven, per the earlier build-vs-buy decision (custom synchronized `ScrollView`s, not a third-party table library).

**Build:**
- Use a custom four-pane matrix: fixed corner cell, horizontally scrolling traveler header, vertically scrolling item-name column, and bidirectionally scrolling check body (§2.6). Do not add `react-native-table-component`; the original project is archived and does not provide the required lifecycle/provenance-aware matrix behavior.
- Synchronize the two horizontal panes and two vertical panes through refs plus a small pure scroll-sync controller: `scrollEventThrottle={16}`, `animated: false`, reentrancy/feedback-loop guards, and no React state update on every scroll event. Keep row heights/offsets identical across the left column and body; category separators must be included in both vertical panes.
- For unusually large lists, use a virtualized vertical body/label pair or a measured-row strategy rather than rendering an unbounded number of cells. The initial implementation may use paired `ScrollView`s because expected lists are low hundreds of rows, but the sync controller must be replaceable with virtualization.
- Use the existing shared-runtime components and test the native behavior with mocked scroll refs; do not introduce Reanimated or a table dependency solely for this feature unless profiling proves the custom implementation inadequate.
- Manual QA pass on a mid-range Android device/emulator specifically for scroll-sync jitter, in addition to iOS.

**Tests:**
- Native-specific rendering tests mirroring the web ones, plus unit tests for the scroll-sync controller (horizontal/vertical propagation, feedback-loop suppression, clamping, and unmount safety). A device/E2E pass remains necessary for gesture latency and visual jitter.

**Definition of Done:** native trip packing screen usable on iOS and Android without visible desync; jitter QA notes recorded in the PR description.

---

## Phase 9 — E2E, rollout, cleanup

**Goal:** close the loop and retire v1.

**Build:**
- Playwright E2E flow per §9: two profiles, shared trip, merged/deduped groups, trip-owned preset survives the actor leaving even when unshared, manual item survives member removal, and traveler removal retracts only that traveler's profile-derived items.
- Enable `packing_lists_v2` for canary accounts; monitor reconciliation/error/latency per §10 step 7.
- Once stable: flip the flag on by default, then in a follow-up PR remove the v1 flattened-`items` compatibility field and any now-dead v1-only code paths — do this as its own small cleanup PR, not bundled with the rollout flip.

**Definition of Done:** E2E test passes in CI; flag rollout plan documented (even if the actual staged rollout happens outside this repo, e.g. via admin panel toggles); v1 compatibility code has a tracked removal step rather than lingering indefinitely.

---

## Requirements traceability checklist

| Requirement | Implementation coverage | Required verification |
| --- | --- | --- |
| Preset catalog, suggestions, and General non-overlap | Phase 0 content/parser; Phase 2 seed sync; Phase 6 admin UI | Directory-wide validation of all 25 current files; collision/duplicate parser tests |
| Profile preferred presets and editable personal list | Phase 3 adapter operations; Phase 5 APIs; Phase 6 account UI | Preference, empty-list, and active-trip reconciliation tests |
| Trip starts from all active traveler profiles | Phase 3 composition; Phase 5 lifecycle wiring | Trip creation, invite acceptance, direct add/un-remove tests |
| Traveler removal retracts only profile-derived sources | Phase 3 provenance; Phase 4 backfill; Phase 5 lifecycle wiring | Shared/manual/unshared-trip-preset removal tests |
| One ordered screen with dedup and empty-group suppression | Phase 0 shared display helper; Phase 3 response; Phase 7 UI | Exact group-order (including Multiple Travelers) and no-extra-category tests |
| Current traveler first, remaining travelers alphabetical | Phase 0 display fixtures; Phase 7 UI | Current-viewer, non-traveler, tie-break, and packed-cell tests |
| Frozen header/first column on web and native | Phase 7 web sticky matrix; Phase 8 custom native four-pane matrix | Browser scroll test plus native sync-controller/device tests |
| Markdown seed sync, admin upload, and removal | Phase 0/2 parser/sync; Phase 5 admin APIs; Phase 6 admin UI | Hash, deployment asset, upload, soft-remove/reactivate, and audit tests |
| Performance, maintenance, and testability | Shared pure helper; indexed/provenance schema; Phase 8 sync controller; all phase DoDs | Typecheck, adapter parity, profiling/large-list QA, PostgreSQL/memory/Firestore coverage |

---

## Sequencing summary

```
0 (pure logic) ─┬─> 1 (schema) ─> 2 (catalog sync) ─> 3 (adapter ops) ─┬─> 4 (migration/backfill)
                │                                                       │
                └───────────────────────────────────────────────────────┴─> 5 (routes) ─> 6 (account/admin UI) ─> 7 (web trip UI) ─> 8 (native trip UI) ─> 9 (E2E/rollout)
```

Phases 0 and 1 can start in parallel (no shared files). Phase 4 depends on both Phase 1 (schema) and Phase 3 (adapter functions) but not on Phase 2 directly, though in practice do it after Phase 2 so the catalog exists for realistic test fixtures. Everything from Phase 5 onward is strictly sequential since each depends on the previous phase's surface.
