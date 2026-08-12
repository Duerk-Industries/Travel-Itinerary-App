# Implementation Plan: Activities Inline Grid Editing and Unified Detail Dialogs

This is the change-by-file implementation summary for
[Activities Inline Editing and Shared Trip-Item Detail Dialogs](../../docs/implementation_plans/activities-inline-edit-and-shared-detail-dialogs.md).

Status: Proposed — implementation-ready. Active-trip-member authorization, multi-level undo/redo (including
the follow-up correctness review), native interaction scope, and staged-delete behavior are all confirmed;
no open decisions remain.

## Confirmed decisions

- **Edit/delete authorization:** confirmed — every active full trip traveler may edit/delete any activity.
  Guest placeholders, pending invitees, removed members, and non-members remain excluded.
- **Native clipboard:** confirmed — web receives rectangular multi-select and TSV copy/cut/paste. Native
  receives format-aware single-cell editing and per-row delete, with no rectangular selection or clipboard
  even on a device with an attached hardware keyboard (reliable keyboard-attachment detection across
  platforms is itself fragile, and this keeps native fully covered by the Phase 2 native work). A
  hardware-keyboard clipboard mode is an explicit out-of-scope follow-up, not part of this plan.
- **Delete and undo behavior:** stage deletion locally, make it reversible until Save, and provide multi-level
  undo/redo within the active edit session on **both** platforms via toolbar buttons (web adds keyboard
  shortcuts). Do not persist undo history after Save or across devices. See the linked plan's §2a for the
  five specific undo/redo correctness rules (partial-Save history retention, in-flight-Save locking,
  native-text-field-undo scoping, redo-stack truncation, toolbar parity).
- **All activity fields:** every user-facing persisted or computed activity field gets its own column in edit
  mode. Technical IDs remain hidden row keys. Rating/vote columns are visible but read-only; GetYourGuide is
  an action, not a persisted field.

## Proposed changes

### Configuration and limits

#### `server/config/api-limits.yaml`

Add a YAML-backed internal provider/caller family for this feature. Suggested starting names:

- `ACTIVITIES_API / ACTIVITIES_LIST`
- `ACTIVITIES_API / ACTIVITIES_BULK_SAVE`
- `ACTIVITIES_API / ACTIVITIES_ACTIVITY_ROW_WRITE`
- `ACTIVITIES_API / ACTIVITIES_ACTIVITY_ROW_DELETE`

(`ACTIVITIES_API`, not a company-wide namespace — matches how every existing `api-limits.yaml` provider is
scoped to one system/feature, e.g. `OPENAI`, `GCS`, `FIRESTORE_PLAID`.)

Suggested starting caps are `overall: 100000`, `ACTIVITIES_LIST: 50000`, `ACTIVITIES_BULK_SAVE: 1000`,
`ACTIVITIES_ACTIVITY_ROW_WRITE: 20000`, and `ACTIVITIES_ACTIVITY_ROW_DELETE: 5000` per day. These are
planning values to calibrate against capacity before production enablement. The route must reserve through
`reserveApiUsageOrThrow`; environment-variable HTTP limits cannot be the only cap.

#### `server/config/cost-model.yaml`

Add the feature's incremental usage to the existing `googleCloudHosting` estimates and keep the assumptions
visible:

- Basic planning case: 2 edit sessions/user/month × 10 rows/session.
- Premium planning case: 6 edit sessions/user/month × 20 rows/session.
- One bulk request per session when under 50 rows.
- Firebase planning case: up to two writes and four reads per changed row for activity/expense
  read-modify-write behavior.

Include average and hard-cap scenarios. Use the existing configured unit prices for Cloud Run requests,
Firestore reads, and Firestore writes. If deletes are tracked separately, add a consistent
`firestore_deletes` metric to both the estimator and model; otherwise document the write/delete bucket used.

At the current planning rates, the Firebase-only incremental average is approximately `$0.00012/user/month`
for Basic (2 requests, 80 reads, 40 writes) and `$0.00072/user/month` for Premium (6 requests, 480 reads,
240 writes), before baseline hosting, Postgres, egress, or separately billed deletes. These are planning
estimates, not a provider quote; expose assumptions and observed usage separately.

### Feature flags

#### `server/config/feature-flags.yaml`

Add all flags with default `false`:

- `feature_grid_editing` — Activities Edit table entry point, grid, staged deletion, Save/Cancel, and bulk
  route.
- `feature_grid_editing_clipboard` — web rectangular selection and clipboard handlers only.
- `feature_standardized_item_dialogs` — shared flight/accommodation/activity detail dialog adoption.

Client and server must use the existing feature-flag loading and DB override behavior. The bulk route must
remain unavailable when `feature_grid_editing` is disabled.

### Shared UI primitives

#### `app/components/EditableDataGrid.tsx`

New generic, schema-driven component.

- Web: cell focus, shift-click/drag rectangular selection, keyboard movement, TSV copy/cut/paste, same-column
  enforcement, staged-delete column, and cell-level errors.
- Native: same column schema and formatters, compact/tappable single-cell editors, trailing per-row delete;
  do not mount browser clipboard listeners or web selection state.
- No network code. Expose draft changes, staged deletes, validation errors, Save, Cancel, Undo, and Redo
  callbacks.
- Keep a bounded multi-level command history for logical actions, including paste ranges, multi-select edits,
  and delete/restore. Coalesce character-by-character typing into one logical edit.
- Keep row rendering keyed by activity ID so editing one cell does not remount every row.
- **Undo/Redo review findings (see the linked plan's §2a for full rationale) — implement all five:**
  1. History clears on a *fully successful* Save only. A partial-failure Save reconciles the succeeded rows
     as the new baseline but leaves history intact so a still-failed row stays undoable. Cancel always
     clears both drafts and history.
  2. Undo/Redo and further cell entry are disabled for the duration of an in-flight Save request, to avoid a
     race between a local mutation and the snapshot already sent to the server.
  3. The `Ctrl+Z`/`Cmd+Z` grid shortcut is only wired when the selected cell is committed (not while a text/
     textarea cell editor has focus) — while typing, native/browser per-character undo is left alone;
     committing the cell (blur/Enter) is what creates the one coalesced grid-level history entry.
  4. Any new edit made after an Undo truncates the redo stack (standard editor semantics).
  5. Undo/Redo is available on **both** platforms via always-visible toolbar buttons (disabled when their
     stack is empty); web additionally gets the keyboard shortcuts from point 3. This is a capability
     separate from the web-only rectangular-selection/clipboard split — native keeps Undo/Redo.

#### `app/components/editableGridTypes.ts`

Define typed column, selection, parse-result, validation-error, and edit-session contracts. Avoid `any`.

#### `app/utils/clipboardGrid.ts`

Pure TSV serializer/parser and multi-select resolver.

- Support tabs, newlines, CRLF, blank cells, and quoted values.
- Reject cross-column paste and invalid dimensions without partially mutating drafts.
- Allow one source cell to repeat over a same-column range.
- Serialize `Paid By` and `Travelers` as semicolon-separated active member display names.
- Resolve by stable ID, email, or case-insensitive display name; reject unknown names.
- Clear cut sources only after the target paste parses and validates successfully.

### Activity schema and editing

#### `app/utils/activityTableSchema.ts` or feature-local equivalent

Define the complete user-facing activity column list and formatters. Columns in edit mode:

1. `date` — date picker, `YYYY-MM-DD`.
2. `activityType` — existing `ACTIVITY_TYPES` select.
3. `name` — text.
4. `startLocation` — text.
5. `startTime` — time picker, `HH:mm`.
6. `duration` — text, preserving current duration semantics.
7. `status` — existing itinerary-status select.
8. `cost` — decimal/currency editor using existing sanitization.
9. `freeCancelBy` — nullable date picker.
10. `bookedOn` — text/platform name, matching the current data model.
11. `reference` — text.
12. `notes` — multiline editor or stable-height popover textarea.
13. `paidBy` — traveler multi-select.
14. `travelerIds` — traveler multi-select.
15. `netRating` — read-only numeric field.
16. `userRating` — read-only user-specific rating.
17. `netVotes` / `userVote` — read-only vote field(s).
18. Suggestions — existing GetYourGuide action where available.
19. Actions — far-right Delete button, edit mode only.

Technical IDs and creator identifiers remain hidden stable row keys. Read-only columns cannot be paste targets.

Reuse `Tour`, `TourDraft`, existing status/type constants, `buildActivityPayload`, and server DTO rules. Do
not create a second set of activity validation rules.

#### `app/components/ActivityEditingForm.tsx`

Extract the existing activity modal fields from `app/tabs/activities.tsx` so both the modal and grid cell
editors share formatters, member selection, validation, and payload normalization. Preserve web/native date,
select, payer, traveler, and notes behavior.

#### `app/tabs/activities.tsx`

- Add an Edit table button gated by `feature_grid_editing`.
- Keep view mode unchanged.
- In edit mode render all schema columns, with Actions always far right.
- Maintain local `originalById`, `draftById`, dirty cells, validation errors, pending deletes, selection, and
  save status.
- Save only dirty rows and pending deletes; Cancel restores the original snapshot.
- Use the active trip's existing `tours` state as the cache and reconcile successful server results into it.
- Keep read-only/following mode unable to enter edit mode or delete.
- Replace the legacy activity details modal with the shared detail dialog behind
  `feature_standardized_item_dialogs`.

### Bulk activity API

#### `server/src/routes/activityDtos.ts`

Add a bulk DTO with a 50-entry cap across `updates + deletes`. Reuse `updateActivityDto` for each update;
do not accept fields that a single-row update rejects.

#### `server/src/routes/activityRoutes.ts`

Add `PATCH /api/activities/bulk` before `/:id`.

- Authenticate and check `feature_grid_editing`.
- Reserve `ACTIVITIES_BULK_SAVE` through `reserveApiUsageOrThrow`.
- Retain user/IP burst protection through the existing HTTP rate-limit service.
- Reserve one row-operation unit for each update/delete before storage work.
- Validate request shape and the 50-entry cap before touching storage.
- Reuse existing update/delete authorization and expense synchronization.
- Return independent per-row success/error results; do not silently discard failed drafts.

Suggested response:

```ts
{
  updates: Array<{ id: string; ok: boolean; error?: string; activity?: Activity }>;
  deletes: Array<{ id: string; ok: boolean; error?: string }>;
}
```

The client caps one editing session at 200 row operations and chunks requests at 50. A malformed request
fails before any row is attempted; valid rows in an otherwise valid request may succeed independently.

#### `server/src/db.ts`, `server/src/db.postgres.ts`, `server/src/db.firebase.ts`

Add adapter-parity bulk methods. Keep Postgres loops pg-mem-compatible; do not use unsupported `ANY(uuid[])`
or multi-row `VALUES` forms. Firebase may batch safely under the 50-row limit, but the result must still
preserve row-level failures. `db.memory.ts` must continue to inherit or implement the same behavior.

### Activity authorization

Confirmed requirement: change `updateActivity` and `deleteActivity` in both database adapters from
creator-only to active full-trip-member scope. Any active full traveler may edit/delete any activity in the
trip. Exclude guest placeholders, pending invitees, removed members, and non-members. Apply the shared DB
change to existing single-row and bulk routes together, and cover it with authorization regression tests
before enabling the grid.

### Shared detail dialogs

#### `app/components/TripItemDetailsDialog.tsx`

Generalize the `DialogShell`/`LodgingDetailsDialog` pattern:

- Shared header, body detail-row layout, close behavior, accessibility, and footer.
- Entity adapters for flight, accommodation, and activity detail rows.
- Preserve lodging maps/photos/place content and activity vote/rating content.
- Consistent Close / Edit / Delete placement and test IDs.
- Hide Edit/Delete in read-only mode.
- Delete routes through `ConfirmDialog`.
- Edit closes details and opens the existing entity-specific editor; it does not turn the detail dialog into a
  giant all-entity form.

#### `app/tabs/overview.tsx` and `app/App.tsx`

Move toward a single selected-item discriminated union:

```ts
type SelectedTripItem =
  | { kind: 'flight'; id: string }
  | { kind: 'lodging'; id: string }
  | { kind: 'activity'; id: string };
```

Migrate Overview's ad hoc flight/activity modal and lodging detail path to one shared dialog instance behind
`feature_standardized_item_dialogs`. Continue using `TransferEditingForm` (flights), `LodgingForm`, and the
activity edit modal as the editors. Avoid refetching on dialog open; use loaded state and refresh callbacks
after mutation.

`LodgingDetailsDialog.tsx` can be retired only after all lodging-specific content and tests are covered by the
shared component.

## Performance, caching, and cost controls

- No per-keystroke or per-cell network calls.
- No second client cache in v1; active-trip state is the source of truth for the tab and dialogs.
- Memoize formatted projections by activity ID and edit-session revision.
- Do not virtualize initially; revisit around 200 regularly rendered activities.
- Bound request payloads at 50 rows and sessions at 200 row operations.
- Bound aggregate API usage and row-level storage operations with YAML-backed standard usage-limiter callers.
- Keep the user/IP HTTP limiter as burst protection, not as the sole budget.
- Track request count, row updates, row deletes, success/failure, and selected adapter without logging cell
  contents or clipboard data.
- Update cost-model assumptions from measured counters after rollout.

## Test plan

- `app/utils/clipboardGrid.test.ts`: TSV round trips, same-column enforcement, dimensions, cut semantics,
  multi-select resolution, unknown members, and invalid values.
- `app/tests/EditableDataGrid.test.tsx`: edit mode, all columns, far-right Actions column, keyboard/range
  selection, paste, staged deletion, bounded history, Cancel, Save, partial failures, and native fallback.
- `app/tests/EditableDataGrid.undo.test.tsx`: the five reviewed undo/redo behaviors — history retained after
  partial-failure Save vs. cleared after full success, Undo/Redo disabled during an in-flight Save, native
  text-field undo left alone while a cell is actively being typed in, redo-stack truncation on new edits
  after Undo, and toolbar-button parity on native vs. web.
- `app/tests/TripItemDetailsDialog.test.tsx`: all three adapters, field rows, shared footer, read-only,
  Edit routing, and Delete confirmation.
- `server/__tests__/activityAuthorization.test.ts`: active full member can edit/delete another member's
  activity; guest, pending, removed, and non-member cases are denied in both adapters and route types.
- `server/__tests__/activityBulkRoutes.test.ts`: DTO cap, session cap, authorization, partial failure,
  feature flag, YAML-backed usage limit, HTTP burst limit, and row-operation reservations.
- Database adapter tests: Postgres/pg-mem and Firebase parity, expense synchronization, and no unsupported
  bulk SQL.
- Existing single-row activity authorization tests must remain green.
- Playwright: copy/cut/paste multi-row same-column edits, multi-select cells, invalid cross-column paste,
  staged delete/cancel/save, reload persistence, and consistent Overview dialogs for all three entities.
- Manual native checks: date/time/select/multi-select editors, horizontal layout, row deletion, accessibility,
  and no browser clipboard code path mounted.

## Implementation order

1. Apply and verify active-trip-member authorization; retain native clipboard as the only open scope decision.
2. Add feature flags, API-limit callers, cost-model assumptions, and tests for configuration loading.
3. Extract shared activity form/schema and add clipboard/grid pure utilities.
4. Build and test `EditableDataGrid` web/native interaction layers.
5. Add the Activities edit session, staged reversible delete UI, and multi-level Undo/Redo.
6. Add the capped bulk DTO, route, limiter reservations, adapter methods, and expense synchronization.
7. Build and migrate the shared detail dialog.
8. Run focused unit/component/API tests, then Playwright and native manual verification.
9. Enable clipboard, grid editing, and shared dialogs independently using their feature flags.
