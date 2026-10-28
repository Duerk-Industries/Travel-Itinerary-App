# Itinerary templates

A template is a ready-made plan for a destination. In the Create Trip wizard, once a traveler has chosen a destination, the templates aligned with it are offered as cards (picture, route, summary, highlights). Choosing one opens a day-by-day preview; **Use this template** creates the trip with the start date already entered, and the trip then behaves like any other.

Templates are free for every tier. The `trip_templates` feature flag (default on) is the only switch.

## What a traveler sees

- **Only aligned templates.** Nothing is offered until a destination is chosen, and only templates whose country matches a chosen country (or country of a chosen city) appear. Templates that visit a chosen city sort first.
- **Pictures where available.** Each card asks the existing `/api/itinerary/images` endpoint for `imageQuery`; a card with no picture is plain text.
- **Everything is a suggestion.** Activities and transfers arrive as `Proposed`, or `Needs Booking` where the plan says to book ahead. Hotels are placeholders ("Hotel in Kyoto") that carry the `Choose your hotel` feature tag. The lodging list shows "Choose your hotel" until the stay is edited and saved, which removes the tag.
- **Transfer tips become day notes.** A stored transfer has no notes field, so the route, travel time, tips and booking advice for each leg are added as a Note on that day of the itinerary.

## Where the data lives

| What | Where |
|---|---|
| Plan (stays, activities, transfers) | `server/data/trip-templates/<pack>-<id>.json`, in the repo, read at runtime |
| Destination association | `trip_templates` table / Firestore collection, refreshed from the seed files at startup (`syncTripTemplatesFromSeed`) |
| `enabled` | Database only. Seeding never re-enables a template that was switched off |
| Generator | `server/tools/trip-templates/` |

The seed JSON is validated on load (`tripTemplateService.ts`); an invalid file is logged and skipped, never fatal. A catalogue row whose seed file has gone is never offered.

## API

All under `/api/trip-templates`, signed-in users only, 404 when the flag is off.

- `GET /?locationIds=&countries=&cities=`: summaries for the chosen destinations (empty when none match).
- `GET /:id`: the template with its day-by-day `preview`.
- `POST /:id/trip`: `{ startDate, name?, locationIds?, participants?, currency? }`. The template sets the length. It goes through the same limits and entitlement checks as the wizard (`createWizardTrip`), and a trip that fails to fill is deleted again.

## Adding a destination

The generator is destination-agnostic. A destination is a **pack**: `server/tools/trip-templates/packs/<name>.py`, which defines reusable day blocks, `build()` returning `Template` objects, a `META` table (summary, `image_query`, optional hand-picked `highlights`) and `build_with_meta()`. See `packs/japan.py`.

```
cd server
python tools/trip-templates/generate.py --pack japan --seed data/trip-templates    # app seed data
python tools/trip-templates/generate.py --pack japan --csv out --start 2027-04-05  # Format C CSVs
```

`--only T04` limits it to one template. Commit the regenerated JSON; the next deploy picks it up.
