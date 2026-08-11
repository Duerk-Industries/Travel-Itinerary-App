# Implementation Plan: Activities Inline Grid Editing and Unified Detail Dialogs

Standardize the trip item detailed view and add a high-productivity spreadsheet-style grid for activities.

## User Review Required

- **Selection and Clipboard Complexity:** Implementing rectangular selection and TSV clipboard support in React Native (Web/Native) requires a robust custom implementation as no existing library in the project currently handles this specialized interaction.
- **Bulk Save Strategy:** The bulk save will be implemented as a single `PATCH /api/activities/bulk` request. Partial failures will be handled by returning individual row status, allowing the user to resolve issues in the grid without losing other changes.

## Proposed Changes

### Configuration and Constants

#### [feature-flags.yaml](file:///C:/Git/Tristan/Travel-Itinerary-App/server/config/feature-flags.yaml)
- Add `feature_grid_editing` and `feature_standardized_item_dialogs`.

#### [api-limits.yaml](file:///C:/Git/Tristan/Travel-Itinerary-App/server/config/api-limits.yaml)
- Add `ACTIVITY_API` provider with limits for `BULK_UPDATE` and `BULK_DELETE`.

---

### Shared Components (UI Primitives)

#### [EditableDataGrid.tsx](file:///C:/Git/Tristan/Travel-Itinerary-App/app/components/EditableDataGrid.tsx)
- **New Component:** A generic, high-performance grid supporting:
    - Custom column definitions and cell editors.
    - Rectangular cell selection and arrow-key navigation.
    - TSV Copy/Cut/Paste integration.
    - Staged row deletion and "dirty" row tracking.

#### [TripItemDetailsDialog.tsx](file:///C:/Git/Tristan/Travel-Itinerary-App/app/components/TripItemDetailsDialog.tsx)
- **New Component:** A unified dialog for viewing details of Flights, Lodgings, and Activities.
- Integrates "Edit" (opens entity editor) and "Delete" (with confirmation) in a standardized footer.

---

### Activities Tab Refactoring

#### [ActivityEditingForm.tsx](file:///C:/Git/Tristan/Travel-Itinerary-App/app/components/ActivityEditingForm.tsx)
- **New Component:** Extracted logic from `activities.tsx` to provide a consistent form for both modals and potential grid popovers.

#### [activities.tsx](file:///C:/Git/Tristan/Travel-Itinerary-App/app/tabs/activities.tsx)
- Add "Edit table" button.
- Implement the transition to `EditableDataGrid` when editing.
- Define activity-specific columns (Date, Type, Name, Location, etc.).
- Implement bulk save logic calling the new API.

---

### Server (Bulk Operations)

#### [activityRoutes.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/routes/activityRoutes.ts)
- Add `PATCH /api/activities/bulk`.
- Add `DELETE /api/activities/bulk`.
- Implement robust validation for multi-row payloads.

#### [db.postgres.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/db.postgres.ts) and [db.firebase.ts](file:///C:/Git/Tristan/Travel-Itinerary-App/server/src/db.firebase.ts)
- Add `bulkUpdateActivities` and `bulkDeleteActivities` implementations.
- Ensure associated expenses are updated/removed.

---

### Overview Tab Migration

#### [overview.tsx](file:///C:/Git/Tristan/Travel-Itinerary-App/app/tabs/overview.tsx)
- Replace fragmented detail modal logic with `TripItemDetailsDialog`.
- Unify the selected-item state model.

## Verification Plan

### Automated Tests
- **Unit Tests:** `app/utils/clipboardGrid.test.ts` for TSV parsing/formatting; `server/src/routes/activityRoutes.test.ts` for bulk endpoint validation.
- **Component Tests:** `app/components/EditableDataGrid.test.tsx` for selection and keyboard navigation logic.
- **E2E Tests:** `app/e2e/activities-grid.test.ts` for full copy/paste and bulk save flow.

### Manual Verification
- Verify rectangular selection across multi-select columns (Travelers/Payers).
- Confirm that cutting a cell only clears the source after a successful paste.
- Test "Delete" staging in the grid followed by "Cancel" to ensure restoration.
- Open different trip items from Overview and verify consistent action placement.
