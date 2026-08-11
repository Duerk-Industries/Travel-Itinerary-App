# Activities Inline Editing and Shared Trip-Item Detail Dialogs

Status: Proposed

## Objective

Add spreadsheet-style grid editing to the Activities table and standardize the detail-dialog experience for flights, accommodations, and activities across the application.

The change should allow a traveler to:

- Toggle a dedicated grid-editing mode for the Activities table.
- Edit activity fields directly in their table columns using format-aware editors (date pickers, type selects, multi-selects).
- Use a far-right column in the grid to stage activities for deletion.
- Perform multi-cell rectangular selection for bulk operations.
- Copy, cut, and paste TSV data between cells of the same column (including multi-select fields).
- Save or cancel a session of changes in a single bulk operation.
- Open a consistent detail dialog for any trip item (flight, accommodation, activity) from the Overview tab.
- Edit or delete items from these dialogs using standardized action placement and confirmation.

## Architecture

### 1. Generic Editable Data Grid

A reusable `EditableDataGrid` component will be added to `app/components/` to handle the low-level spreadsheet interactions.

**Key responsibilities:**
- Render a header row and data rows based on a `ColumnDefinition` array.
- Maintain a local selection state supporting single-cell and rectangular multi-cell ranges.
- Capture and process standard keyboard events (arrows, shift-arrows, Enter, Esc).
- Handle `onCopy`, `onCut`, and `onPaste` events to exchange TSV data with the clipboard.
- Manage "staged" row deletion state visually.
- Expose a `onChange` callback when a range of cells is updated.

### 2. Activity Table Schema and Editors

A specific configuration for `EditableDataGrid` will be created for Activities, defining the columns and their respective editor components.

| Column | Field | Component | Format |
| --- | --- | --- | --- |
| Date | `date` | `DateCellEditor` | `YYYY-MM-DD` |
| Type | `activityType` | `SelectCellEditor` | Enum Label |
| Name | `name` | `TextCellEditor` | Plain Text |
| Location | `startLocation` | `TextCellEditor` | Plain Text |
| Time | `startTime` | `TimeCellEditor` | `HH:mm` |
| Duration| `duration` | `TextCellEditor` | Text |
| Status | `status` | `SelectCellEditor` | Itinerary Status |
| Cost | `cost` | `DecimalCellEditor` | Decimal |
| Cancel By| `freeCancelBy` | `DateCellEditor` | `YYYY-MM-DD` (Nullable) |
| Booked On| `bookedOn` | `DateCellEditor` | `YYYY-MM-DD` (Nullable) |
| Reference| `reference` | `TextCellEditor` | Plain Text |
| Notes | `notes` | `TextAreaCellEditor`| Multiline Text |
| Paid By | `paidBy` | `MultiSelectCellEditor`| Semicolon-separated names/IDs |
| Travelers| `travelerIds` | `MultiSelectCellEditor`| Semicolon-separated names/IDs |
| Actions | — | `DeleteActionCell` | Delete Button (stages for removal) |

### 3. Shared Trip Item Detail Dialogs

Standardize the "view details" experience by creating `TripItemDetailsDialog`. This component will unify `LodgingDetailsDialog` with new adapters for Flights and Activities.

**Standardized Layout:**
- **Header:** Large title, status badge, and clear close button.
- **Body:** Labeled detail rows and supplemental content (maps, photos for lodging).
- **Footer:** Unified action row with "Close", "Edit", and "Delete".
- **Interaction:** "Edit" closes details and opens the specific entity editor; "Delete" opens a confirmation dialog.

### 4. Bulk Activity API

To support efficient saving of grid edit sessions, a new bulk endpoint will be added to the server.

- **Endpoint:** `PATCH /api/activities/bulk`
- **Payload:** Array of modified activity IDs with their updated fields, and an array of IDs to delete.
- **Logic:** Validates each row using existing DTO rules; synchronizes corresponding expense records.

## Feature Flags

The feature set will be introduced behind two primary flags in `server/config/feature-flags.yaml`:

1.  `feature_grid_editing`: Enables the "Edit table" button and spreadsheet interaction in the Activities tab.
2.  `feature_standardized_item_dialogs`: Toggles the use of the new `TripItemDetailsDialog` across Overview and other tabs.

## Cost and API Limits

- **Storage:** Bulk updates will be capped at 50 activities per request to prevent excessive database load.
- **Compute:** The bulk update logic will be metered under the `ACTIVITY_API` limit in `api-limits.yaml`.
- **Latency:** Client-side grid edits are local-only; network requests only occur on "Save changes", minimizing per-keystroke overhead.

## Implementation Plan

### Phase 1: Shared Activity Form and Logic
- Extract activity editing logic from `activities.tsx` into `ActivityEditingForm.tsx`.
- Centralize `buildActivityPayload` and validation rules.

### Phase 2: Editable Grid Primitives
- Create `EditableDataGrid.tsx` and its supporting types.
- Implement selection, keyboard navigation, and TSV clipboard support.
- Add format-aware cell editors (Date, Time, Multi-select).

### Phase 3: Activities Grid Integration
- Add "Edit table" toggle to `ActivitiesTab`.
- Wire the grid to use the Activity schema.
- Implement the "Save" and "Cancel" session state.

### Phase 4: Server Bulk Support
- Implement `PATCH /api/activities/bulk` in `activityRoutes.ts`.
- Add bulk update and delete methods to `db.ts` and its adapters.

### Phase 5: Standardized Detail Dialogs
- Create `TripItemDetailsDialog.tsx` using the `DialogShell` pattern.
- Migrate Flights, Lodging, and Activities to use this shared component for their detailed view.

### Phase 6: Verification
- Unit tests for TSV parsing and rectangular selection logic.
- Component tests for grid editors and dialog transitions.
- Playwright E2E tests for bulk save and copy/paste scenarios.
