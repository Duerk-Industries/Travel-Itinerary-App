# Activities Inline Editing and Shared Trip-Item Detail Dialogs

Status: Implemented — feature flags are disabled by default for controlled rollout. Authorization,
multi-level undo/redo, native interaction scope, and all-fields interpretation are implemented; focused
verification passes, with the repository-wide build retaining unrelated pre-existing blockers.

## Review result and confirmed decisions

1. **Who may edit or delete?** Confirmed: every active full trip traveler may edit or delete activities.
   Guest placeholders, pending invitees, removed members, and non-members remain excluded.
2. **Native clipboard scope:** confirmed native stays single-cell-only — tap to edit one cell, toolbar
   Undo/Redo, per-row delete — with no rectangular selection or clipboard shortcuts, even on a device with
   an attached hardware/Bluetooth keyboard. Reliable keyboard-attachment detection across iOS/Android/tablet
   configurations is itself fragile, and this keeps the native code path fully covered by the Phase 2 native
   fallback work with no extra native-only selection/clipboard surface to build or test. A hardware-keyboard
   clipboard mode can be revisited later as a scoped follow-up if usage data justifies it — it is out of
   scope for this plan (see [Non-Goals](#non-goals)).
3. **Save semantics:** confirmed: edits and deletes are staged locally, Delete is reversible until Save, and
   the session provides multi-level undo/redo before Save. The undo/redo design itself was specifically
   re-reviewed for correctness — see [§2a](#2a-undoredo-design-reviewed).
4. **All-fields interpretation:** the grid includes every user-facing activity field, including read-only
   rating/vote fields as columns. Technical IDs remain hidden row keys, and the GetYourGuide suggestion is
   an action rather than a persisted activity field.

## Objective

Add spreadsheet-style grid editing to the Activities table with a full web experience and a usable native
fallback, and standardize the "view details" dialog for flights, accommodations, and activities across the
app (Overview and each tab).

The change should allow a traveler to:

- Toggle a dedicated grid-editing mode for the Activities table (web).
- Edit activity fields directly in their table columns using format-aware editors (date pickers, type
  selects, multi-selects).
- Use a far-right column in the grid to stage activities for deletion.
- On web: perform multi-cell rectangular selection and TSV copy/cut/paste between cells of the same
  column, including multi-select fields.
- On native: edit one cell at a time and delete a row via a per-row button; no rectangular selection or
  clipboard interaction (see [Platform Scope](#platform-scope-web-vs-native)).
- Save or cancel a session of changes in a single bulk operation, with per-row success/failure feedback.
- Open a consistent detail dialog for any trip item (flight, accommodation, activity) with standardized
  Close / Edit / Delete actions.

## Non-Goals

- Grid editing for Flights, Lodging, or Car Rentals tables. Only Activities gets the spreadsheet grid in
  this phase; the pattern is designed to be reusable later but this plan does not implement it elsewhere.
- Changing the existing per-field edit *forms* (`ActivityEditingForm`, `TransferEditingForm`,
  `LodgingForm`). The shared dialog work in this plan unifies the **view/detail** layout and its
  Edit/Delete footer only — see [Proposed decision log](#proposed-decision-log).
- Undo/redo persistence after Save or across browser/device sessions. Multi-level undo/redo is required
  within the active edit session.
- Changing authorization beyond active full trip travelers. Guest placeholders, pending invitees, removed
  members, and non-members remain excluded. See [Security](#7-security-and-authorization).

## Proposed decision log

These decisions incorporate the confirmed product direction; none remain open.

1. **Native grid UX:** Simplified native mode. Native gets the same column schema and a tap-to-edit-one-
   cell interaction plus a per-row delete button, but no rectangular multi-select and no clipboard
   integration, even with an attached hardware keyboard. Those are web-only. Undo/Redo, however, is not
   part of this split — see decision 6.
2. **Multi-select clipboard paste:** Pasted text for `Paid By` / `Travelers` columns resolves by
   case-insensitive display-name match against the trip's active group members (`;`-separated). Unresolved
   names are surfaced as a cell-level validation error before save; the cell is not silently dropped.
3. **Dialog unification depth:** Unify the **view/detail** dialog only. `TripItemDetailsDialog` standardizes
   layout and the Close/Edit/Delete footer for flights, lodging, and activities. "Edit" continues to open
   each entity's existing dedicated edit form/modal unchanged.
4. **Bulk save semantics:** `PATCH /api/activities/bulk` returns per-row `ok`/`error` status (not an
   all-or-nothing transaction), so one invalid row doesn't block the rest of a session from saving. Capped
   at 50 rows per request; a session with more staged edits is chunked into sequential requests client-side.
5. **Authorization is active-trip-member scoped.** Any active full traveler may edit/delete any activity in
   the trip. Guest placeholders, pending invitees, removed members, and non-members cannot. The shared DB
   methods and all single-row/bulk routes must enforce this consistently.
6. **Undo/Redo is a grid-wide capability on both platforms**, exposed via always-visible toolbar buttons on
   both web and native, plus keyboard shortcuts on web only. It is orthogonal to decision 1's web-only
   selection/clipboard split. Full design and the specific correctness review are in
   [§2a](#2a-undoredo-design-reviewed).

## Platform Scope (web vs. native)

True spreadsheet rectangular drag-select and TSV clipboard exchange depend on browser-only primitives
(`document.addEventListener('copy'/'cut'/'paste', ...)`, `ClipboardEvent.clipboardData`, mouse drag with
`document`-level `mouseup`/`mousemove` listeners) that don't exist in React Native, and the OS clipboard on
iOS/Android is plain text with no equivalent multi-cell drag gesture. Building a custom native
implementation would be high-risk, hard to test, and easy to get wrong around focus/keyboard behavior on
different devices.

Given that, `EditableDataGrid` renders two interaction modes from **one shared column/schema config**, so
the two platforms never drift on what fields exist or how they're formatted:

- **Web (`Platform.OS === 'web'`):** full grid — click/shift-click/drag rectangular selection, arrow-key
  navigation, `onCopy`/`onCut`/`onPaste` TSV exchange, staged-delete column.
- **Native:** each cell renders as a tappable row of compact fields; tapping a cell opens the same
  format-aware editor inline (date picker, select, etc.) for that one cell only. A trailing delete button
  per row stages that row for removal. No selection state, no clipboard listeners are mounted at all on
  native — the module simply doesn't import/attach them, keeping bundle weight and behavior obviously safe
  device the OS clipboard could otherwise leak plain text into.

`feature_grid_editing` gates the "Edit table" entry point on both platforms; there is a second flag,
`feature_grid_editing_clipboard`, scoped to just the web copy/cut/paste handlers (see
[Feature Flags](#5-feature-flags)) so clipboard behavior can be killed independently if it misbehaves without
disabling cell editing entirely.

## Architecture

### 1. Generic Editable Data Grid

A reusable `EditableDataGrid` component is added to `app/components/`. It is generic over a
`ColumnDefinition<T>[]` and a row array, so it can in principle back other tables later, but this plan only
wires it to Activities.

**Key responsibilities:**
- Render a header row and data rows from `ColumnDefinition[]`.
- Maintain local selection state: single cell on native; rectangular multi-cell range on web.
- Web only: capture keyboard events (arrows, shift+arrow, Enter, Esc, Ctrl/Cmd+C/X/V) scoped to the grid
  container (not global `document` listeners) so the grid doesn't intercept keystrokes elsewhere on the
  page.
- Web only: `onCopy`/`onCut`/`onPaste` handlers that serialize/parse TSV, one column at a time (pasting
  never crosses column boundaries — a paste whose source column doesn't match the destination column's
  editor type is rejected with an inline error rather than silently coerced).
- Track "dirty" cells (edited-but-unsaved) and "staged for deletion" rows in local component state only —
  nothing is sent to the server until Save.
- Client-side field validation runs per cell on change/paste (same rules as `buildActivityPayload`/
  `updateActivityDto`), so invalid values are flagged in the grid before the user hits Save rather than
  discovered only from a failed API response.
- Maintain multi-level undo/redo history for the current edit session. Each history entry should be a
  compact reversible command or before/after patch for one logical user action, including paste ranges,
  multi-select changes, and staged deletion/restore. Coalesce keystrokes in one cell within a short debounce
  window so typing a value does not create one history entry per character.
- Expose `onSessionSave(changes)`, `onSessionCancel()`, `onUndo()`, and `onRedo()` callbacks; the grid itself
  holds no network code. Disable Undo/Redo when the corresponding stack is empty and announce the action to
  screen readers.

**Explicitly out of scope for `EditableDataGrid` v1:** cross-column paste, freeform multi-row paste that
grows the row count (only paste into existing rows), undo/redo persistence after Save or across devices, and
any drag-to-resize/reorder column affordance.

### 2. Activity Table Schema and Editors

| Column | Field | Component | Format | Notes |
| --- | --- | --- | --- | --- |
| Date | `date` | `DateCellEditor` | `YYYY-MM-DD` | Native uses the existing `NativeDateTimePicker`; web uses `<input type="date">` (matches the current edit-modal pattern in `activities.tsx`). |
| Type | `activityType` | `SelectCellEditor` | `ActivityType` enum | Options from the existing `ACTIVITY_TYPES` constant — not redefined. |
| Name | `name` | `TextCellEditor` | Plain text | Required unless `shouldRelaxRequiredFields(status)`. |
| Location | `startLocation` | `TextCellEditor` | Plain text | |
| Time | `startTime` | `TimeCellEditor` | `HH:mm` | |
| Duration | `duration` | `TextCellEditor` | Free text (matches current field; not a structured duration type) | |
| Status | `status` | `SelectCellEditor` | `ItineraryStatus` enum | Options from `ITINERARY_STATUSES`. |
| Cost | `cost` | `DecimalCellEditor` | Decimal string | Reuses `sanitizeCostInput`. |
| Cancel By | `freeCancelBy` | `DateCellEditor` | `YYYY-MM-DD`, nullable | Empty cell = clears the field, matching the existing "Clear" link in the edit modal. |
| Booked On | `bookedOn` | `TextCellEditor` | Plain text (platform name) | Matches current field, not a date. |
| Reference | `reference` | `TextCellEditor` | Plain text | |
| Notes | `notes` | `TextAreaCellEditor` | Multiline text | Renders as a popover textarea on cell activation rather than an inline growing cell, to keep row height stable. |
| Paid By | `paidBy` | `MultiSelectCellEditor` | `;`-separated display names | See [Proposed decision log](#proposed-decision-log) #2 for paste-resolution rules. |
| Travelers | `travelerIds` | `MultiSelectCellEditor` | `;`-separated display names | Same resolution rules as Paid By. |
| Rating | `netRating` | `ReadOnlyCell` | Numeric rating | Server-computed; visible in its own column, not editable or paste targets. |
| Your rating | `userRating` | `ReadOnlyCell` | Numeric rating or blank | Server-computed/user-specific; visible in its own column, not editable or paste targets. |
| Votes | `netVotes` / `userVote` | `ReadOnlyCell` | Vote total / current user's vote | Server-computed; visible in its own column, not editable or paste targets. |
| Suggestions | — | `ReadOnlyActionCell` | Existing GetYourGuide action | Not persisted activity data; remains a non-editing action column. |
| Actions | — | `DeleteActionCell` | Delete button | Always the far-right column in edit mode. It is absent in view mode. |

The technical `id`, `tripId`, and creator/user identifiers remain hidden stable row keys rather than user
editable columns. Every user-facing persisted or computed activity field is otherwise represented in its
own column. Read-only columns cannot be selected as paste destinations, but they remain visible so Edit
table does not hide activity data.

The edit session should maintain `originalById`, `draftById`, `pendingDeleteIds`, `dirtyCells`, validation
errors, and bounded `undoStack`/`redoStack`. Undo and redo operate only on local drafts; they never call the
API. Use a bounded history size (for example, 100 logical actions) and show a non-blocking notice if the
oldest history entry is dropped. The full undo/redo design, including how it interacts with partial-failure
Save and native/web scoping, is reviewed in detail in [§2a](#2a-undoredo-design-reviewed).

### 2a. Undo/Redo Design (reviewed)

This section was specifically re-reviewed for correctness, since undo/redo is the part of this feature most
likely to have subtle state-management bugs. Five behaviors need to be explicit and were previously
underspecified or only implied:

1. **History clearing on Save must account for partial failure, not just success/failure.** The original
   wording ("Save clears the history after successful reconciliation") is ambiguous about the common
   Decision-Log-#4 case: a bulk Save where *some* rows succeed and others fail per-row. The corrected rule:
   - A **fully successful** Save (zero rows returned with `ok: false`) clears the undo/redo stack entirely —
     there is nothing left to usefully undo back to, since the drafts are now the persisted state.
   - A **partial-failure** Save does **not** clear history. The rows that succeeded are reconciled into
     `originalById`/`draftById` as the new baseline (so undoing past that point is a no-op for those specific
     rows — there's nothing to revert to locally since the server already has the new value), but the
     undo/redo stack itself stays intact so the user can still undo the edit on a *still-failed* row (e.g. to
     fix a bad value and retry) without losing their place. This matters because the most likely reason a row
     fails is a bad value the user just entered — undo is how they'd fix it.
   - **Cancel** always discards the entire session (drafts and history together), regardless of any earlier
     partial Save — this was already correct and is unchanged.
2. **Undo/Redo (and further edits) are disabled while a Save request is in flight.** Mutating local drafts
   while a `PATCH /api/activities/bulk` request is in flight for those same rows creates a race between the
   in-flight request body (a snapshot taken at Save time) and a local Undo that changes what the user
   *thinks* is still pending. The grid must snapshot the dirty rows at the moment Save is invoked, disable
   editing/Undo/Redo for the whole grid until that request resolves, then reconcile per-row results before
   re-enabling. This is a small addition to the existing "no per-keystroke network traffic" design (§8) but
   was not previously called out for the Save-in-flight window specifically.
3. **Grid-level Undo must not fight native/browser text-field undo.** On web, `Ctrl+Z`/`Cmd+Z` is also the
   browser's native undo inside a focused `<input>`/`<textarea>`. If the grid attaches a document- or
   container-level `keydown` handler for `Ctrl+Z` unconditionally, it will either double-undo (one character
   reverted by the browser, then a whole logical edit reverted by the grid) or fight the native input's own
   undo stack. The fix: the grid's keyboard shortcut for Undo/Redo is only active when the currently
   selected cell is in its **committed** (read) state, not while a cell is in active inline text-edit mode —
   while a text/textarea cell editor has focus, `Ctrl+Z` is left alone to do the browser's normal
   single-input undo, and committing the cell (blur or Enter) is what creates the one coalesced grid-level
   history entry for that edit (this matches the existing "coalesce keystrokes" rule, just makes the
   focus-scoping explicit). The toolbar Undo/Redo **buttons** (see point 5) are always active regardless of
   focus, since a button click isn't ambiguous the way a global keyboard shortcut is.
4. **A new edit after an Undo clears the Redo stack**, standard editor semantics that wasn't previously
   stated: if the user undoes two actions and then makes a new edit (rather than redoing), the two
   previously-undone actions are no longer redoable. Only explicit Redo calls replay history; any other
   mutation (edit, paste, delete, restore) truncates `redoStack`.
5. **Undo/Redo is a grid-wide capability on both platforms, not just web.** The web/native split in
   [Platform Scope](#platform-scope-web-vs-native) is specifically about rectangular *selection* and
   *clipboard* — it does not mean native loses Undo/Redo. Native gets the same command-history stack (it's
   valuable there too, e.g. undoing an accidental row deletion) exposed as two always-visible toolbar
   buttons (disabled/greyed when their stack is empty) rather than a keyboard shortcut, since native has no
   reliable global `Ctrl+Z` equivalent. Web gets both the toolbar buttons (for discoverability and non-
   keyboard users) and the `Ctrl+Z` / `Ctrl+Shift+Z` (and `Cmd` variants on macOS) shortcuts scoped per
   point 3. Both platforms announce Undo/Redo outcomes via the existing accessibility live-region pattern
   (e.g. "Undid change to Cost on Museum tour") so the effect of a non-visual action is perceivable.

A restored row (Undo of a staged delete) does not need explicit position tracking — the grid re-sorts by
date/time exactly as the read-only view does today (`sortedTours`), so the row simply reappears in its
natural sorted position rather than needing to be reinserted at a remembered index.

### 3. Shared Trip Item Detail Dialog

`TripItemDetailsDialog` is a new component in `app/components/` that generalizes the existing
`LodgingDetailsDialog` pattern (which already uses `DialogShell`) to also cover Flights and Activities.

**Standardized layout (same for all three item types):**
- **Header:** image (lodging only — flights/activities have no photo today, so this region collapses),
  title, status badge, close (✕) button.
- **Body:** labeled detail rows built from a per-type `DetailRow[]` adapter function
  (`buildLodgingDetailRows`, `buildFlightDetailRows`, `buildActivityDetailRows`), plus type-specific
  supplemental content (map preview for lodging, vote/rating action row for activities, per the existing
  `shouldShowVoteButtons`/`shouldShowRatingButtons` gates).
- **Footer:** one unified action row — `Close`, and (when not `readOnly`) `Edit` and `Delete`, in that
  fixed order, matching `LodgingDetailsDialog`'s current placement and `testID` convention
  (`{entity}-details-edit-{id}` / `{entity}-details-delete-{id}`).
- **Interaction:** `Edit` closes the details dialog and opens the entity's existing edit modal
  (`ActivityEditingForm` state in `activities.tsx`, the flight edit modal in `transfers.tsx`, or
  `LodgingForm`) — unchanged per [Proposed decision log](#proposed-decision-log) #3. `Delete` opens the existing
  `ConfirmDialog` before calling the entity's existing delete API helper
  (`removeActivityApi`, the transfers equivalent, or the lodging equivalent).

`activities.tsx`'s current inline `selectedTour` modal (the `renderDetailRow` block at
[activities.tsx:492-701](../../app/tabs/activities.tsx)) and `overview.tsx`'s ad hoc flight/activity detail
modal state are both replaced by `TripItemDetailsDialog`, removing duplicated detail-row markup. Lodging's
existing usage of `LodgingDetailsDialog` in `overview.tsx` migrates to the new component;
`LodgingDetailsDialog` itself is retired in favor of `TripItemDetailsDialog` configured with the lodging
adapter, so there is exactly one detail-dialog implementation afterward, not two.

### 4. Bulk Activity API

- **Endpoint:** `PATCH /api/activities/bulk`
- **Auth:** `authenticate` middleware (existing pattern), then per-row authorization using the same
  confirmed active-trip-member `updateActivity`/`deleteActivity` rule as the existing single-row routes.
  Both routes must use the shared DB methods so authorization cannot drift;
   see [Activity authorization](#activity-authorization).
- **Payload:** `{ updates: Array<{ id: string; fields: Partial<TourDraft> }>; deletes: string[] }`, capped
  at 50 combined `updates.length + deletes.length` entries — enforced both client-side (chunking) and
  server-side (DTO rejects payloads over the cap with 400, so a modified/hostile client can't bypass the
  cap).
- **Validation:** each `updates[]` entry is parsed with the existing `updateActivityDto` (via `readDto`),
  so a single shared validation path is reused rather than a new bulk-specific schema; the endpoint does
  not accept fields `updateActivityDto` doesn't already accept.
- **Logic:**
  1. Validate the whole payload shape and cap up front (before touching the DB) — a malformed payload
     fails the whole request with 400, since nothing has been attempted yet.
  2. For each `updates[]` row: call the existing `updateActivity(id, userId, fields)` and, on success,
     `upsertExpenseForSource` exactly as `PUT /:id` does today. For each `deletes[]` id: call the existing
     `deleteActivity` + `deleteExpenseForSource`. Each row's outcome (`ok`, or `error` with a message) is
     collected independently — one row's failure/no-op does not stop or roll back the others (proposed decision
     #4).
  3. Respond `200` with `{ updates: Array<{ id: string; ok: boolean; error?: string; activity?: Activity }>; deletes: Array<{ id: string; ok: boolean; error?: string }> }` so the client can reconcile exactly which staged
     changes actually landed.
- **Rate limiting:** reserve the named internal caller through the standard `usageLimiter` and
  `server/config/api-limits.yaml` configuration before doing any work. Also retain the existing
  user/IP HTTP abuse guard as a secondary identity-scoped limit. The YAML limit is the authoritative
  aggregate cap; environment-variable overrides must not be the only cap. See
  [Cost and API Limits](#6-cost-and-api-limits).

### Activity authorization

Confirmed: any active full traveler may edit/delete any activity in the trip. Guest placeholders, pending
invitees, removed members, and non-members remain excluded. Today, `updateActivity`/`deleteActivity` (in
both `db.postgres.ts` and `db.firebase.ts`) are creator-scoped, so the shared database methods must be
changed before the UI is enabled. Lodging's equivalent functions already use trip-group membership
(`db.postgres.ts:4322-4469`, `db.firebase.ts:4623-4657`, via `ensureUserInTrip`).

- **Postgres (`db.postgres.ts`):** rewrite `updateActivity`/`deleteActivity`'s `WHERE` clause from
  `id = $1 AND user_id = $2` to the same "any active member of the trip's group" shape Lodging uses —
  join `tours` → `trips` → `group_members` and require `gm.user_id = $2` (this alone already excludes
  guest placeholder rows, which have no `user_id`). Additionally require `gm.removed_at IS NULL` and no
  matching `trip_removals` row, matching `ensureUserInTrip`'s stricter definition of "active member" (the
  existing inline Lodging query doesn't check `removed_at`, which is a minor gap in the precedent this plan
  does not need to inherit — Activities gets the stricter, correct check from day one). Keep both the
  pg-mem-safe in-memory branch and the native-Postgres branch, mirroring Lodging's existing dual-query
  structure so `db.memory.ts` keeps working via its `...postgresAdapter` spread.
- **Firebase (`db.firebase.ts`):** replace the `if ((doc.data() as any).userId !== userId) throw new
  Error('Not authorized')` check in `updateActivity`/`deleteActivity` with the same
  `ensureUserInTrip(tripId, userId)` call Lodging's Firebase functions already use (read the activity doc
  for its `tripId`, look up membership, proceed only if found).
- **Blast radius:** this fixes authorization for *all* current callers of these two functions — the
  existing single-row `PUT /:id`/`PATCH /:id`/`DELETE /:id` routes in `activityRoutes.ts` get the fix for
  free (no route-level code change needed there), and the new bulk endpoint (§4) is built on the corrected
  functions from the start rather than needing a follow-up fix.
- **What does not change:** guests (no `user_id`), pending invitees (no accepted membership row yet), and
  removed members remain unable to edit or delete, exactly as before. Trip visibility (`listActivities`)
  was already scoped to the group and is unaffected.
- **Concurrent-removal edge case:** if a member is removed from the trip *during* an open grid-editing
  session, their next Save attempt on that trip's rows fails per-row with a clear "You're no longer a
  member of this trip" error (not a silent revert) — the same per-row error-surfacing the grid already
  needs for other validation failures (§10).

This authorization change is required for the grid and must be covered by authorization regression tests
before production enablement.

#### Database adapters

`bulkUpdateActivities` / `bulkDeleteActivities` are added to `db.ts` (facade) and implemented directly in
both `db.postgres.ts` and `db.firebase.ts` (per the project's adapter-parity rule); `db.memory.ts` inherits
them automatically via its `...postgresAdapter` spread, **provided** the Postgres implementation stays
pg-mem-compatible:

- Do **not** implement this as a single multi-row `UPDATE ... FROM (VALUES ...)` or
  `WHERE id = ANY($1::uuid[])` — pg-mem doesn't support `ANY(uuid[])` binding (see existing pg-mem notes).
  Instead, loop over the validated rows and issue the existing single-row `updateActivity`/`deleteActivity`
  queries per row. This is already what the per-row-status design in the proposed decision #4 needs anyway (each row
  needs its own success/failure), so there's no tension between pg-mem compatibility and the chosen API
  semantics.
- Firebase: batch with `WriteBatch`, capped well under Firestore's 500-writes-per-batch ceiling by the
  50-row request cap; batch writes are still evaluated for per-row read-modify-write success so the
  response shape matches Postgres's per-row result array.

### 5. Feature Flags

Seeded in `server/config/feature-flags.yaml` (missing rows only; DB value wins at runtime, same as every
other flag):

| Flag | Gates | Default |
| --- | --- | --- |
| `feature_grid_editing` | The "Edit table" entry point in `ActivitiesTab` (both platforms) and the `PATCH /api/activities/bulk` route itself (returns 404/`FEATURE_DISABLED` when off, mirroring how other feature-flagged routes fail closed). | `false` — new, higher-risk UI surface; enable after internal verification. |
| `feature_grid_editing_clipboard` | Just the web copy/cut/paste handlers inside `EditableDataGrid`. Independent kill switch: if TSV parsing or clipboard event handling misbehaves in production, this can be flipped off without losing cell-by-cell editing or the delete column. | `false` initially, flipped on after `feature_grid_editing` proves stable. |
| `feature_standardized_item_dialogs` | Whether Overview, Activities, and Lodging tabs render `TripItemDetailsDialog` vs. legacy detail modals. | `false` — flip on once all three adapters pass verification. |

Both client and server check flags the existing way: client via the flags already fetched at session
bootstrap (same mechanism `AdminTab`/other gated UI uses), server via the flag-check helper already used by
other `feature_*` routes — no new plumbing required.

### 6. Cost and API Limits

This feature introduces **no new external/paid API calls**. Detail dialogs use the already-loaded item
data and do not refetch when opened. Clipboard parsing, selection, validation, and draft state are local.

#### Standard API-limiting architecture

All new internal activity traffic must use the repository's standard `reserveApiUsageOrThrow` path, not an
untracked route-local counter. Add an internal provider/caller family to
`server/config/api-limits.yaml`, for example:

```yaml
  ACTIVITIES_API:
    window: day
    windowHours: 24
    overall: 100000
    callers:
      ACTIVITIES_LIST: 50000
      ACTIVITIES_BULK_SAVE: 1000
      ACTIVITIES_ACTIVITY_ROW_WRITE: 20000
      ACTIVITIES_ACTIVITY_ROW_DELETE: 5000
```

(Named `ACTIVITIES_API`, not a company-wide namespace — every existing entry in `api-limits.yaml` is scoped
to one system or feature, e.g. `OPENAI`, `GCS`, `FIRESTORE_PLAID`, not a blanket internal bucket, so a new
provider follows that same convention.)

The exact production values require capacity calibration, but the named limits must exist before the flag
is enabled. The route behavior is:

- `GET /api/activities` reserves `ACTIVITIES_LIST` once per request.
- `PATCH /api/activities/bulk` reserves `ACTIVITIES_BULK_SAVE` once per request, then reserves one
  `ACTIVITIES_ACTIVITY_ROW_WRITE` or `ACTIVITIES_ACTIVITY_ROW_DELETE` unit for every staged row operation.
- The DTO caps the combined `updates + deletes` at 50 rows/request.
- The client caps one editing session at 200 row operations and chunks requests at 50 rows.
- The existing user/IP HTTP rate-limit guard remains a secondary abuse-control layer, but it is not the only
  cap and its environment overrides cannot bypass the YAML aggregate cap.
- No new detail-dialog request is permitted merely because a dialog opened. If a future adapter needs a
  direct read, add a named caller and cap before implementation.

The limiter must reserve before storage work. A failed storage operation may still consume the reservation;
that conservative behavior prevents retry storms from bypassing the cap. Add `ACTIVITIES_API` coverage
(limits, concurrent reservations, durability across a simulated restart) alongside the existing provider
cases in `server/__tests__/usage-limiter-durable.test.ts`, plus flag-off and counter-reset coverage in
`activityBulkRoutes.test.ts`.

#### Storage and cost estimate

The grid does not add a new paid provider. It adds bounded Cloud Run requests and database operations. Update
`server/config/cost-model.yaml` with explicit incremental usage rather than leaving the feature absent from
the estimator. Use conservative planning assumptions and label them as estimates:

| Tier | Assumed edit sessions/user/month | Rows/session | Bulk requests | Activity/expense storage operations |
| --- | ---: | ---: | ---: | ---: |
| Basic | 2 | 10 | 2 | 40 writes, plus bounded reads for read-modify-write paths |
| Premium | 6 | 20 | 6 | 240 writes, plus bounded reads for read-modify-write paths |

For Firebase, budget each changed row as up to two document writes (activity plus expense) and up to four
document reads when the adapter must read membership, the activity, and the expense state. Deletes should be
counted in the same write/delete cost bucket used by the current Google Cloud estimator, or a
`firestore_deletes` metric should be added consistently to both the estimator and cost model. For Postgres,
the equivalent resource is Cloud Run/database work rather than Firestore billing.

The estimator should expose both average planning cost and hard-cap usage. At the hard cap, one user can issue
20 requests per ten-minute HTTP window, each with 50 row operations, subject to the daily YAML aggregate and
the 200-row session cap. This is deliberately much higher than the expected average and must not be used as
the average cost assumption.

Using the current `cost-model.yaml` rates, the incremental monthly estimate is calculated as:

```text
cloud_run_requests * $0.40 / 1,000,000
+ firestore_reads * $0.06 / 100,000
+ firestore_writes * $0.18 / 100,000
+ storage/egress deltas, if the selected adapter actually incurs them
```

The implementation should record activity bulk-save counters by row operation and request outcome so the
cost model can be revised from observed usage without enabling verbose per-cell logging.

### 7. Security and Authorization

- **Authorization is server-enforced:** any active full trip traveler may edit/delete any activity. The bulk
  route and existing single-row routes must use the same shared DB authorization rule. Guest placeholders,
  pending invitees, removed members, and non-members remain denied. Test every category in both adapters.
- **Residual per-row failure mode:** if a user's membership changes during an open grid session, Save must
  surface the affected row(s) rather than silently reverting them. The draft and server error should remain
  available for review until the user cancels or refreshes.
- **Trip membership still gates visibility:** `listActivities` already scopes to trip-group members via the
  `trips`/group join — nothing changes there; a user can only ever stage edits for rows they can already
  see.
- **DTO validation is the trust boundary:** every row in a bulk payload passes through the existing
  `updateActivityDto`/`createActivityDto` schemas (via `readDto`) exactly as single-row endpoints do — the
  bulk endpoint adds no new fields and no relaxed validation, only a request-shape wrapper and a cap.
- **Rate limiting doubles as abuse mitigation:** the YAML-backed standard usage limiter bounds aggregate API
  and row-operation volume, while the user/IP HTTP guard limits one identity's burst rate. The 50-row request
  cap and 200-row session cap bound storage work per interaction.
- **Clipboard data is untrusted input:** pasted TSV is parsed and validated through the same per-cell rules
  as manual entry before it's ever staged as a pending change — a paste can't inject a value that manual
  typing couldn't produce (e.g. an invalid `activityType` pasted from another app is rejected the same way
  an invalid typed value would be).
- **`TripItemDetailsDialog`'s Delete action** continues to route through `ConfirmDialog` before calling the
  existing per-entity delete endpoint — no direct delete-on-click, matching current behavior for lodging.

### 8. Performance

- **Grid render cost:** Activities lists are typically small (tens, not thousands, of rows per trip); no
  virtualization is planned for v1. If a future trip regularly exceeds ~200 activities, revisit with
  windowing (e.g. only mount visible rows) rather than optimizing prematurely.
- **Caching and consistency:** use the existing active-trip `tours` state as the client cache. Opening a
  detail dialog reads the selected item from that state and does not issue a new request. Memoize column
  projections and formatted display values by activity ID plus edit-session revision. After Save, reconcile
  successful rows into the existing state and refetch only when the response does not contain the canonical
  updated row. Do not add a second cache layer for v1; stale activity data is worse than the small read
  savings, and another cache would require invalidation rules for expenses, overview, and dialogs.
- **No per-keystroke network traffic:** all edits are held in local component state (`Map<rowId,
  Partial<TourDraft>>` of dirty fields + `Set<rowId>` of staged deletes) until Save, avoiding both
  server load and the "juggling many in-flight PATCHs" failure mode a naive per-cell-autosave design would
  have.
- **Single re-render path:** cell edits update only the affected row's local state slice (keyed by id), not
  the whole `tours` array, so typing in one cell doesn't re-render every row.
- **Bulk save latency:** one `PATCH` request for up to 50 rows is bounded and predictable; the DB-side loop
  is sequential per row (see §4) which keeps worst-case latency roughly linear in row count — acceptable at
  the 50-row cap, revisit only if real usage shows this endpoint is slow.

### 9. Maintainability

- `EditableDataGrid` is schema-driven and entity-agnostic: Activities-specific knowledge lives only in the
  `ColumnDefinition[]` passed in from `activities.tsx`, not inside the grid component itself, so it stays
  reusable if another tab wants grid editing later.
- Existing single-row types/validation/entitlement paths (`TourDraft`, `buildActivityPayload`,
  `updateActivityDto`, `updateActivity`/`deleteActivity`) are all **reused**, not duplicated, by both the
  legacy per-row edit modal and the new grid/bulk paths — one source of truth for what a valid activity
  looks like.
- `TripItemDetailsDialog` is the feature-flagged detail surface for Overview, Activities, and Lodging tabs;
  the legacy lodging dialog remains available only as the rollback path while the shared lodging adapter is
  verified. Future field additions to the shared detail view happen in one place.
- All new feature flags default `false`, so this ships dark and is enabled deliberately after internal
  verification, consistent with how other recent higher-risk surfaces in this codebase (e.g.
  `trip_blog_*` phases) were rolled out.

### 10. Test Coverage

- **Unit tests (`app/utils/`):**
  - `clipboardGrid.ts` (new) — TSV serialize/parse round-trips, including embedded tabs/newlines/quotes,
    empty cells, and the multi-select name-resolution + unresolved-name error path from proposed decision #2.
  - Bulk-payload chunking (>50 staged rows split into sequential requests) and per-row result reconciliation
    logic.
- **Component tests (`app/tests/`):**
  - `EditableDataGrid.test.tsx` — keyboard navigation, rectangular selection (web path), staged-delete
    toggling, paste ranges, dirty-state tracking, bounded history, and the native single-cell-edit fallback
    path rendering when `Platform.OS !== 'web'` is mocked.
  - `EditableDataGrid.undo.test.tsx` (new, covers §2a specifically) — a fully successful Save clears
    history; a partial-failure Save preserves history for still-failed rows while pruning it for
    now-reconciled rows; Undo/Redo and cell entry are disabled for the duration of an in-flight Save; typing
    in a focused text cell leaves the browser's native per-character undo alone and only commit (blur/Enter)
    creates one grid-level history entry; a new edit after Undo truncates the redo stack; Undo/Redo toolbar
    buttons are present, keyboard-triggerable, and correctly disabled/enabled on native (buttons only) vs.
    web (buttons + shortcuts).
  - `TripItemDetailsDialog.test.tsx` — all three adapters render their expected `DetailRow[]`, `readOnly`
    hides Edit/Delete, Delete routes through `ConfirmDialog`.
- **Server tests (`server/__tests__/`):**
  - `activityAuthorization.test.ts` (new) — verifies that a non-creator active full trip member can update
    and delete an activity, while guest, pending, removed, and non-member accounts cannot. Cover both
    `db.postgres.ts` (including the pg-mem branch) and `db.firebase.ts`, plus existing single-row routes and
    the bulk route.
  - `activityBulkRoutes.test.ts` (new) — cap enforcement (400 above 50), session cap, per-row partial-failure
    behavior (one invalid row doesn't block valid rows), authorization scoping, standard YAML-backed usage
    limit exhaustion, user/IP burst-limit exhaustion, and feature-flag-off → route disabled.
  - `db.postgres.test.ts` / equivalent for `db.firebase.ts` — `bulkUpdateActivities`/`bulkDeleteActivities`
    against pg-mem, confirming the loop-based implementation stays pg-mem-compatible (no `ANY(uuid[])`
    regressions).
- **E2E (Playwright, web only, `app/e2e/`):**
  - `activities-grid.test.ts` — toggle edit mode, edit a cell, rectangular-select + copy + paste into
    another column of the same type, stage and cancel a delete (row restored), stage and save a delete (row
    removed), Save session persists across reload.
  - `trip-item-details-dialog.test.ts` — open details from Overview for a flight, a lodging, and an
    activity; confirm consistent Close/Edit/Delete placement and that Edit opens the right existing edit
    form for each type.
- **Manual verification checklist:**
  - Rectangular selection spanning the Travelers/Paid By columns pastes and resolves names correctly,
    including a deliberately-misspelled name to confirm the validation error surfaces per cell.
  - Cutting a cell only clears the source after a successful paste (not before, and not if the paste target
    is invalid).
  - Native: tap-to-edit and per-row delete work with no crash from absent clipboard/selection code paths.
  - Verify the confirmed authorization policy with creator, active member, guest, pending, removed, and
    non-member accounts. Active full members must be able to edit/delete activities created by another
    member; all excluded categories must receive a safe per-row failure.
  - A user whose membership/permission changes mid-session attempts Save; staged rows fail per-row with a
    clear authorization error instead of silently reverting or generic-erroring.
  - Trigger a partial-failure bulk Save (e.g. one row with a value another client made invalid concurrently)
    and confirm the still-failed row remains undoable while the successful rows do not regress on Undo.
    Confirm Undo/Redo controls are visibly disabled while the Save request is in flight.
  - On web, focus a text cell, type, and press `Ctrl+Z`: confirm only the browser's native character-level
    undo fires, not a grid-level undo of the whole cell; then commit the cell and press `Ctrl+Z` again and
    confirm the whole committed edit reverts as one action.

## Implementation Plan

### Phase 0: Authorization contract
- Update `db.postgres.ts` and `db.firebase.ts` so any active full trip traveler can edit/delete activities,
  while guests, pending invitees, removed members, and non-members remain excluded.
- Add `activityAuthorization.test.ts` for both adapters, existing single-row routes, and the bulk route.
- Ship and verify this authorization change before enabling the grid.

### Phase 1: Shared Activity Form and Logic
- Extract activity editing/validation logic already in `activities.tsx` (`buildActivityPayload`, etc.) into
  a shared module usable by both the existing edit modal and the new bulk/grid paths. No behavior change.

### Phase 2: Editable Grid Primitives (web-first)
- Create `EditableDataGrid.tsx` and `clipboardGrid.ts`.
- Implement web selection, keyboard navigation, and TSV clipboard support behind
  `feature_grid_editing_clipboard`.
- Implement the native single-cell-edit + delete-row fallback path.
- Add format-aware cell editors (Date, Time, Select, MultiSelect, Decimal, TextArea).

### Phase 3: Activities Grid Integration
- Add "Edit table" toggle to `ActivitiesTab`, gated by `feature_grid_editing`.
- Wire the grid to the Activities column schema (§2).
- Implement session Save/Cancel state, multi-level Undo/Redo, staged reversible deletion, and client-side
  chunking for >50 staged rows.

### Phase 4: Server Bulk Support
- Add the named internal provider/callers to `server/config/api-limits.yaml` and reserve them through
  `reserveApiUsageOrThrow` for activity list requests, bulk requests, and row-level storage operations.
- Implement `PATCH /api/activities/bulk` in `activityRoutes.ts`, gated by `feature_grid_editing`, with the
  existing user/IP burst guard as a secondary control.
- Add `bulkUpdateActivities`/`bulkDeleteActivities` to `db.ts`, `db.postgres.ts`, and `db.firebase.ts`
  (loop-based, pg-mem-safe per §4), using the confirmed authorization contract.
- Update `cost-model.yaml` usage estimates and estimator tests per §6; include average and hard-cap scenarios.

### Phase 5: Standardized Detail Dialogs
- Create `TripItemDetailsDialog.tsx` (generalizing `LodgingDetailsDialog`) with per-type `DetailRow[]`
  adapters for flights, lodging, activities.
- Migrate `overview.tsx`, `activities.tsx`, and `LodgingTab.tsx` to use it behind
  `feature_standardized_item_dialogs`; retain `LodgingDetailsDialog` only as the rollback path until the
  shared lodging adapter completes production verification.

### Phase 6: Verification
- Unit tests for TSV parsing, name resolution, and chunking logic.
- Component tests for grid editors, native fallback, and dialog adapters.
- Server tests for the bulk endpoint (cap, partial failure, ownership, rate limit, flag-off).
- Playwright E2E for grid copy/paste/save and the unified details dialog.
- Manual verification checklist above.
