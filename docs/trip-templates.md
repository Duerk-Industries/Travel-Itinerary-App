# Itinerary templates

A template is a ready-made plan for a destination. In the Create Trip wizard, once a traveler has chosen a destination, the templates aligned with it are offered as cards (picture, route, summary, highlights). Choosing one opens a day-by-day preview; **Use this template** creates the trip with the start date already entered, and the trip then behaves like any other.

Templates are free for every tier. The `trip_templates` feature flag (default on) is the only switch.

## What a traveler sees

- **Only aligned templates.** Nothing is offered until a destination is chosen, and only templates whose country matches a chosen country (or country of a chosen city) appear. Templates that visit a chosen city sort first.
- **Pictures where available.** Each card asks the existing `/api/itinerary/images` endpoint for `imageQuery`; a card with no picture is plain text.
- **Everything is a suggestion.** Activities and transfers arrive as `Proposed`, or `Needs Booking` where the plan says to book ahead. Hotels are placeholders ("Hotel in Kyoto") that carry the `Choose your hotel` feature tag. The lodging list shows "Choose your hotel" until the stay is edited and saved, which removes the tag.
- **Transfer tips become day notes.** A stored transfer has no notes field, so the route, travel time, tips and booking advice for each leg are added as a Note on that day of the itinerary.

## Descriptions and pictures

Every activity has a short description and, where one exists, a picture; every destination (country and cities) has a description and one or two pictures. They live in a **shared catalogue**, not in the templates: `server/data/trip-templates/media/<pack>.json`, keyed by place (`japan/fushimi-inari`) and destination (`japan/kyoto`). A template activity carries only the place key, so a stop that appears in six templates is described and pictured once.

- **Descriptions** are original text, written per place in `tools/trip-templates/packs/<pack>_media.py`. On creating a dated trip the description becomes the first line of the activity's notes; on an undated trip it is part of the day-plan item.
- **Pictures** come from Wikimedia Commons and only files whose own metadata declares **public domain or CC0**, with no usage restrictions, are accepted. A picture is stored as a thumbnail URL plus its title, license, author and Commons page; no image bytes ship with the app. The preview shows the credit under each picture.
- **Coverage is partial on purpose.** A stop with no suitable public-domain picture is shown with its description only. The card picture is the first picture of the template's hero destination; if the catalogue has none, the picker falls back to an image search on `imageQuery`.
- **Hotlinking:** thumbnails are served from `thumb.wikimedia.org`. If traffic grows, mirror them into the app's own bucket and change the URLs in the catalogue; nothing else changes.

Refreshing the pictures: `fetch_media.py search` collects candidates, `sheets` writes contact sheets to review by eye, and `build` writes the catalogue using a `choices.json` of your picks (see the script's header). Review the picks: a license tag on Commons is the uploader's declaration, so check the file page for anything you intend to rely on.

## Where the data lives

| What | Where |
|---|---|
| Plan (stays, activities, transfers) | `server/data/trip-templates/<pack>-<id>.json`, in the repo, read at runtime |
| Destination association | `trip_templates` table / Firestore collection, refreshed from the seed files at startup (`syncTripTemplatesFromSeed`) |
| `enabled` | Database only. Seeding never re-enables a template that was switched off |
| Descriptions and pictures | `server/data/trip-templates/media/<pack>.json`, shared by every template |
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
