# Itinerary Item Kinds (Place / Note / Checklist)

> **Where this lives in the UI (Phase 3, 2026-04-25):** The legacy "Itineraries"
> tab was removed. Item kinds and the "+ Add item" popover surface inside the
> **Overview tab's Day Details view** — tap a day card to open it, then scroll
> to the "Notes & Checklists" section under Accommodation. The first "+ Add
> item" press on a trip with no itinerary record auto-creates one before
> persisting the new row.

## What are item kinds?

Each row in an itinerary's per-day list is an `ItineraryDetail` with a `kind`
discriminator. v1 supports four kinds:

| Kind | Use | Distinguishing fields |
|---|---|---|
| `activity` | A scheduled thing to do (legacy default) | `time`, `cost` |
| `place` | A location to visit | `placeId` (Google Places id; nullable in v1) |
| `note` | Free-form text for a day | `noteBody` (plain text; line breaks preserved) |
| `checklist` | A title with toggleable child items | `checklistItems[]` (children) |

Existing rows added before this feature shipped have `kind = 'activity'`. The
column has a `DEFAULT 'activity'` so reads of legacy data are seamless.

## Adding items from the UI

Inside the Overview tab's Day Details view, the "+ Add item" button at the
bottom of the "Notes & Checklists" section opens a popover with four choices:
place, note, checklist, custom activity. Each choice opens a kind-specific
dialog. Day is required on every dialog (defaults to the day card you opened
from); time is optional on place/activity; cost is added later via the row's
Edit action.

If the trip has no itinerary record yet, the first +Add press creates one in
the background (`POST /api/itineraries`) before persisting the new detail.

## Place items

v1 stores a Google Places `place_id` text in the `place_id` column when one
is supplied. The current dialog is text-only — it does not call the Places
API — so `placeId` stays NULL by default and the row's `activity` text holds
the human-readable place name. A future revision can wire in the Google
Places search via `server/src/services/placeService.ts` to populate
`placeId`. Renderers must always tolerate `placeId === null` and fall back
to the `activity` label.

## Note items

`noteBody` is plain text. Line breaks are preserved in the row renderer.
Rich-text formatting was deliberately scoped out of v1 — see the Phase 2
implementation notes in `docs/implementation-plan-itinerary-collab.md` §4
for the rationale.

## Checklist items

A checklist parent (`kind = 'checklist'`) has zero or more children stored in
the `itinerary_checklist_items` table. Children cascade-delete when the
parent detail is removed. Each child has:

- `label` — the displayed text
- `position` — sort order within the checklist
- `checkedBy` + `checkedAt` — who completed the item and when (NULL when
  unchecked). Set automatically by the server when `PATCH ... { checked: true }`.

Any full trip member can add, edit, check, uncheck, or delete child items.
This matches the resolved permission decision in
`docs/implementation-plan-itinerary-collab.md` §7.

## API endpoints

- Existing: `POST /api/itineraries/:id/details` — body now accepts optional
  `kind`, `placeId`, `noteBody`, `checklistItems: [{ label, position? }]`.
  Inline validation (no zod) — kind must be one of the four allowed values.
  When a non-default `kind` is supplied and the `itinerary_item_kinds` flag
  is off, the route returns `403 { code: "FEATURE_DISABLED" }`.
- Existing: `PUT /api/itineraries/details/:detailId` — body now accepts
  optional `placeId`, `noteBody`, `position`. (kind is immutable on update
  in v1.)
- New: `POST /api/itineraries/details/:detailId/checklist-items` — body
  `{ label, position? }`. Append a child to a checklist parent.
- New: `PATCH /api/itineraries/checklist-items/:itemId` — body `{ label?,
  checked?, position? }`. Toggling `checked: true` sets `checked_by` to the
  current user and `checked_at` to now; `checked: false` clears both.
- New: `DELETE /api/itineraries/checklist-items/:itemId`.

## Authorization

All write paths require full trip membership (the same model as itinerary
detail edits). Followers cannot mutate kinds or checklist children.

## Feature flag

- `itinerary_item_kinds` — default `enabled: true` once shipped. When off:
  - The `POST /:id/details` route accepts the legacy activity-only payload
    and returns 403 with `FEATURE_DISABLED` if `kind` is supplied.
  - The new checklist-item routes return 403 unconditionally.
  - The UI hides the "+ Add item" popover and shows the legacy edit form
    only.

## Performance

The list endpoint (`GET /api/itineraries/:id/details`) issues a single
batched fetch for checklist children — one query for parents and one for all
children of those parents — and assembles them in JS. There is no per-detail
N+1.

## Data model rationale

See §4 of `docs/implementation-plan-itinerary-collab.md` for the full
data-model decision (Option A: extend `itinerary_details` with a `kind`
discriminator + nullable type-specific columns, with checklist children in a
sibling table).
