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

- **Descriptions** are original text, written per place in `tools/trip-templates/packs/<pack>_media.py`. Each place has two versions of it: `description`, one sentence, shown while the stop is only on offer (the template preview, the Activities page suggestions and the itinerary's "Add activity" menu), and `details`, an optional paragraph. When a trip is created from a template, or a suggestion is added, the paragraph (the sentence if there is none) becomes the first line of the activity's notes, which is also what the trip export prints; on an undated trip it is part of the day-plan item. Activities added before a paragraph existed keep the sentence.
- **Internal tags** (all optional, so a template or place without them works as before): a template has `pace` and `interests`; a place has `interests` and `mobility`. They use the vocabulary of the AI itinerary generator (`itineraryPreferenceContract.ts`): pace `R`/`B`/`F`, mobility `L`/`M`/`H` (the mobility a traveler needs for the stop), and interests `outdoors`, `adventure`, `culture`, `food`, `nightlife`, `relax`, `photography`, `authentic_local`, `iconic_landmarks`. A template's `sources` (the sites and guides it was researched from) is internal in the same way. The tags are for matching a template or stop to a traveler's preferences and, like `sources`, are never sent to travelers: not in the template list or preview, not in suggestions, not in trip data or its export. They are in the admin download so an edit and re-import keeps them. Nothing reads them yet.
- **Pictures** come from Wikimedia Commons and only files whose own metadata declares **public domain or CC0**, with no usage restrictions, are accepted. A picture is stored as a thumbnail URL plus its title, license, author and Commons page; no image bytes ship with the app. The preview shows the credit under each picture.
- **Coverage is partial on purpose.** A stop with no suitable public-domain picture is shown with its description only. The card picture is the first picture of the template's hero destination; if the catalogue has none, the picker falls back to an image search on `imageQuery`.
- **Hotlinking:** thumbnails are served from `thumb.wikimedia.org`. If traffic grows, mirror them into the app's own bucket and change the URLs in the catalogue; nothing else changes.

Refreshing the pictures: `fetch_media.py search` collects candidates, `sheets` writes contact sheets to review by eye, and `build` writes the catalogue using a `choices.json` of your picks (see the script's header). Review the picks: a license tag on Commons is the uploader's declaration, so check the file page for anything you intend to rely on.

## Suggestions on the Activities page

Every template activity is also a suggestion for any trip, not just trips made from a template. `GET /api/trip-templates/trips/:tripId/activity-suggestions` (trip members only, same flag) returns the activities whose city matches a lodging on that trip, with the trip days spent there. A lodging's city is read from its address and name, so a placeholder ("Kyoto, Japan") and a real hotel address both work. An activity the trip already has, scheduled or optional, is left out when the names match (one contains the other). The same stop in several templates is offered once.

The Activities page lists them with **Add to specific day**, **Add as optional** and **Dismiss**; adding opens the usual editor with the details filled in, so nothing is saved until the traveler confirms. A dismissal is saved per traveler and trip (`trip_dismissed_suggestions`, `POST`/`DELETE …/activity-suggestions/dismissals`), so it holds across visits and devices and other members still see the suggestion; **Bring back N dismissed** restores them. Trips with no dated lodging get no suggestions.

The itinerary's **Add activity** menu (on a day) offers the same ideas for that day: `?date=YYYY-MM-DD` narrows the list to activities in the city the day's lodging puts the traveler in, soonest first. The menu shows the trip's optional activities first, then suggestions below **Add a new activity**, and never more than four in all. Each shows its picture and a one-sentence description; the response's `activityMedia` (by activity id) supplies both for optional activities that match a template activity, and otherwise the activity's own first note line is used. Choosing a suggestion opens the usual editor filled in for that day.

## Writing templates with an LLM, and importing them

Sample itineraries can be written outside the app and put live without a deploy. The unit of exchange is a **bundle**: one JSON file holding any number of templates plus the shared place/destination descriptions they use (format `wanderbunnies.trip-templates`, version 1). Each template inside is exactly a seed file, so a bundle can also be unpacked into `server/data/trip-templates/`.

**Admin → Itinerary Templates** is the whole workflow:

1. **Download instructions** (`INSTRUCTIONS.md`), the **example** (`example-bundle.json`) and, optionally, the **schema** (JSON Schema). Give them to an LLM with a request that is only a destination, such as "create itineraries for Scotland". The LLM finds the ten most useful itinerary sources for it, notes the most common lengths and routes, and combines what they share into generic itineraries in its own words; it fills in the descriptions, paragraphs and internal tags too. Anything the admin adds (a length, a time of year, a pace, interests, a region) narrows which source itineraries it draws on. The instructions also cover the field rules, realism rules, how to write original descriptions, and a self-check list; the files live in `server/data/trip-template-authoring/`.
2. **Import.** Choose the file the LLM produced (or paste it) and press **Check**. Nothing is saved yet: the report lists each template as *new*, *updated* or *unchanged* and spells out every problem (`activities.4.day: 9 is after the last day (6)`), so the list can be pasted back to the LLM for a corrected file. **Import** is enabled only for a file that passed the check, and nothing is saved unless the *whole* file is acceptable. Warnings (for example a place with no description yet) never block.
3. **Improve what is live.** *Download all templates* (or one) returns the live templates in the same bundle shape. Give it to an LLM with a change request and import the result. A template keeps its `id`, so it is **updated in place**; a new `id` adds a template. Importing a built-in template's id replaces it, and **Restore built-in** removes the replacement.

What the checker enforces beyond the shape: `pace`, `interests` and `mobility` use only the values above (anything else is an error naming the field); a `details` paragraph is at most 1200 characters and needs the sentence it expands; the stays tile the trip and their nights equal `days - 1`, every `day` is within the trip, activity types and transfer types come from the allowed lists, times are `HH:MM`, place keys look like `country/place`, and a picture is accepted only as `upload.wikimedia.org`/`thumb.wikimedia.org` with a public-domain or CC0 license (the LLM is told to leave pictures empty and let a maintainer add them with the picture tool).

Where imports live: the `trip_template_imports` table / Firestore collection (`kind` is `template`, `place` or `destination`), read on top of the seed files and re-read at most once a minute, so every server instance picks an import up shortly after it is made. An import with the same id as a seed file wins over it; description entries win key by key. Deleting the import brings the built-in version back. Imports are audited (`TRIP_TEMPLATES_IMPORTED`, `TRIP_TEMPLATE_IMPORT_REMOVED`).

Admin API (all under `/api/admin/trip-templates`, admins only):

- `GET /`: the live templates with their source (`bundled`, `imported`, `imported-override`).
- `GET /export?ids=a,b`: the bundle download (all templates without `ids`).
- `POST /import`: `{ bundle, dryRun }`; `dryRun` defaults to true, so a body without `dryRun: false` only reports. Up to 15 MB (this router has its own JSON parser ahead of the app-wide 100 kb one).
- `DELETE /imported/:id`: removes an imported template.
- `GET /authoring/instructions`, `/authoring/example`, `/authoring/schema`: the downloads for the LLM.

## Where the data lives

| What | Where |
|---|---|
| Plan (stays, activities, transfers) | `server/data/trip-templates/<pack>-<id>.json`, in the repo, read at runtime |
| Destination association | `trip_templates` table / Firestore collection, refreshed from the seed files at startup (`syncTripTemplatesFromSeed`) |
| `enabled` | Database only. Seeding never re-enables a template that was switched off |
| Descriptions and pictures | `server/data/trip-templates/media/<pack>.json`, shared by every template |
| Generator | `server/tools/trip-templates/` |
| Imported templates and descriptions | `trip_template_imports` table / Firestore collection, written by the admin import and read on top of the seed files |
| LLM instructions, example bundle | `server/data/trip-template-authoring/` |

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
