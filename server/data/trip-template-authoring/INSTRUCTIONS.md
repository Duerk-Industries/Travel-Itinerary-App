# WanderBunnies sample itinerary authoring — instructions for an LLM

You are writing **sample itineraries** ("templates") for WanderBunnies, a group trip-planning app. A traveler who picks a destination is offered these as worked examples: a day-by-day plan with a hotel area per stay, activities, and the ground transfers between cities. The traveler can turn one into a trip and then change anything, so every item is a *suggestion*.

You work **outside the app**. Your only output is **one JSON file** (a "bundle") that an administrator downloads from you and imports into WanderBunnies. The app checks the file strictly and rejects anything that does not follow the rules below, so follow them exactly.

---

## 1. How a person uses these instructions

1. Give an LLM this whole document, plus `example-bundle.json` (a complete valid bundle) and, if you have it, `schema.json` (the same format as JSON Schema).
2. Tell it what you want. For example:

   > Using the instructions, write 3 itineraries for **Portugal**: 5 days Lisbon only, 8 days Lisbon + Porto, and 10 days Lisbon, Porto and the Algarve. Relaxed pace, food and history. Return the bundle JSON only.

3. To **change an existing itinerary**, first download the current templates from *Admin → Itinerary templates → Download templates*, give that file to the LLM, and ask for the change. Keep each template's `id` the same and it will be imported as an *update*; a new `id` is imported as a *new* template.
4. Save the LLM's JSON as a `.json` file and import it from *Admin → Itinerary templates → Import*. The app first shows a **preview** (new / updated / unchanged, plus any errors to fix) and only saves when the whole file is acceptable. If there are errors, paste the error list back to the LLM and ask it to return the corrected full file.

## 2. What to ask before writing

If the request does not say, ask (or state your assumption at the very top of your reply, outside the JSON):

- **Destination(s)** and which cities to visit.
- **Length** in days (2 to 21 is typical; the app allows up to 60). Day 1 is the arrival day and the last day is the departure day.
- **Time of year** (affects what is open, weather, daylight).
- **Pace and interests** (relaxed / balanced / packed; food, history, nature, family, nightlife, …).
- **How they arrive and leave** (airport or station), if relevant.
- Whether this **updates** an existing template (use its `id`) or is **new**.

Do not ask about prices: templates carry no costs.

## 3. Output rules

- Reply with **one JSON object in a single code block** and nothing inside the block except JSON (no comments, no trailing commas). Put any assumptions or notes **before** the block, briefly.
- If the file would be too long to return in one reply, return **one bundle per template** (each is complete and importable on its own). Put shared `media` entries in the bundle of the first template that uses them; later bundles may reuse the same keys.
- Use plain UTF-8 text. Straight or typographic quotes are fine inside strings, but escape them as JSON requires.
- Do not invent fields. Unknown fields are ignored by the app, so they only add noise.

## 4. File structure

```json
{
  "format": "wanderbunnies.trip-templates",
  "version": 1,
  "generator": "name of the model or tool that wrote this",
  "templates": [ { ...one template... } ],
  "media": {
    "places":       { "portugal/belem-tower": { "name": "...", "description": "...", "image": null } },
    "destinations": { "portugal/lisbon":      { "name": "...", "description": "...", "images": [] } }
  }
}
```

`format` and `version` must be exactly as shown. `media` may be omitted only if every template you use refers to places and destinations that already exist in the app (normally you will provide them).

### 4.1 A template

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | number | Always `1`. |
| `id` | string | Unique, lowercase letters/digits/hyphens: `portugal-lisbon-porto-8d`. Never reuse an id for a different trip. Reusing an existing id **replaces** that template. |
| `title` | string | Human title with length, e.g. `Lisbon & Porto - 8 days`. |
| `summary` | string | One or two sentences on who it suits and the shape of the trip. |
| `days` | integer | Total days **including arrival day and departure day**. 1–60. |
| `route` | string | The route in one line: `Lisbon > Porto (Sintra day trip)`. |
| `arrive` / `depart` | string | Where the traveler most likely arrives / leaves, e.g. `Lisbon (LIS)`. May be empty. |
| `countries` | string[] | At least one, English names (`"Portugal"`). The first is the main country. Used to decide which travelers are offered the template. |
| `cities` | string[] | Every city the traveler sleeps in or visits as a base, in English, without country (`"Lisbon"`). |
| `imageQuery` | string | A short image-search phrase for a fallback card picture, e.g. `Lisbon Portugal tram`. |
| `highlights` | string[] | 3 to 6 short highlights for the card (a few words each). |
| `destinationKeys` | string[] | Keys of the destination entries in `media.destinations` that describe this trip: the country first, then cities (`"portugal"`, `"portugal/lisbon"`). |
| `hero` | string | The destination key whose first picture should be the card picture (one of `destinationKeys`). |
| `sources` | string[] | Where you got the facts (guidebook names, official tourism sites). For maintainers; not shown. Be honest; leave empty rather than invent. |
| `stays` | object[] | See 4.2. |
| `activities` | object[] | See 4.3. |
| `legs` | object[] | See 4.4. |

**Day numbering.** Every `day` field is an **offset from the first day: 0 = arrival day, 1 = second day, … `days - 1` = departure day.**

### 4.2 `stays` — where the traveler sleeps

```json
{ "base": "Lisbon", "hotel": "Hotel in Lisbon", "start": 0, "nights": 3, "area": "Baixa, Chiado or Principe Real", "breakfast": false, "dinner": false }
```

- `base`: the city (must also appear in `cities`). The app uses this to decide where the traveler is on each day, which drives the "suggested activities" feature, so **write the city name the way a hotel address would**: `"Lisbon"`, not `"Lisboa"` or `"the capital"`.
- `hotel`: always a placeholder like `Hotel in Lisbon`. **Never name a real hotel.**
- `start`: the day offset of check-in. The first stay starts at `0`.
- `nights`: whole number ≥ 1.
- `area`: where to look for a hotel and why, short.
- `breakfast` / `dinner`: `true` only if the plan assumes a package with that meal; normally `false`.
- **Stays must tile the trip:** each stay's `start` equals the previous stay's `start + nights`, and the nights add up to **`days - 1`** (a 7-day trip has 6 nights; the last day is departure).

### 4.3 `activities` — things to do

```json
{
  "day": 1, "type": "Ticketed Attraction", "time": "09:00", "duration": "1.5h",
  "name": "Jerónimos Monastery", "notes": "Go at opening; the queue grows by mid-morning.",
  "where": "Belém, Lisbon", "book": "Yes - buy timed tickets online to skip the queue", "place": "portugal/jeronimos-monastery"
}
```

- `day`: 0 to `days - 1`.
- `type`: exactly one of `Class`, `Concert/Show`, `Day Trip`, `Event`, `Food & Drink`, `Fun & Games`, `Hike`, `Nightlife`, `Other`, `Open Access`, `Outdoor Activity`, `Reservation`, `Shopping`, `Sights & Landmarks`, `Spa/Wellness`, `Ticketed Attraction`, `Tour`.
- `time`: 24-hour `HH:MM`, or `""` if flexible. Order activities in a day by time.
- `duration`: short text such as `1h`, `1.5h`, `2h`, `half day`. Realistic, including queues.
- `name`: the name a traveler would search for. Specific, not generic ("Castelo de São Jorge", not "Visit a castle").
- `notes`: one or two practical sentences (when to go, what to skip, how it connects). No prices.
- `where`: neighbourhood/area and city, so it can be found on a map: `Alfama, Lisbon`.
- `book`: `""` if no advance booking is needed. Otherwise start with **`Yes - `** and give the reason (`Yes - timed tickets sell out in season`). Only use it where booking ahead genuinely matters.
- `place`: the key of this stop in `media.places` (see 4.5). Format `country/place-slug`, lowercase, hyphens, ASCII: `portugal/belem-tower`. The same place used in several templates must use the **same key**.

### 4.4 `legs` — ground transfers between bases and from/to the airport

```json
{ "day": 3, "transferType": "Public Transit", "from": "Lisbon Santa Apolonia Station", "to": "Porto Campanha Station", "time": "09:00", "minutes": 175, "carrier": "Alfa Pendular or Intercidades (CP)", "notes": "Fast trains run roughly hourly; sit on the right for river views.", "book": "Yes - reserve a seat on Alfa Pendular" }
```

- `transferType`: `Public Transit` (trains, metro, buses, ferries), `Private Transfer` (taxi, driver, rental car), or `Other`. **No flights.**
- `from` / `to`: specific places (station, airport, neighbourhood).
- `time`: departure `HH:MM` if a sensible fixed time, else `""` (for airport legs the traveler's flight decides).
- `minutes`: door-to-door-ish travel time for that one leg, a whole number, realistic.
- `carrier`: operator or mode (`Metro Red Line`, `Taxi or Uber`).
- `notes`: tips; `book`: as above.
- Include a leg for **arrival-to-first-hotel** (day 0), every **move between bases**, and **last-hotel-to-airport/station** (departure day). Day-trip returns are legs too.

### 4.5 `media` — shared descriptions and pictures

`media.places[key]` for every distinct `place` key you used:

```json
"portugal/belem-tower": { "name": "Belém Tower", "description": "A fortified riverside tower from the 1500s ...", "image": null }
```

`media.destinations[key]` for the country and each city:

```json
"portugal/lisbon": { "name": "Lisbon", "description": "A hilly riverside capital of tiled façades, trams and ...", "images": [] }
```

- `description`: **one or two sentences (under 300 characters)** saying what the place *is* and why people go. Written by you, in your own words. This sentence is shown to travelers and becomes the first line of the activity's notes.
- **Pictures: leave `"image": null` and `"images": []`.** Pictures are added later by a maintainer who can check licenses. Only include a picture if you can open the Wikimedia Commons file page and confirm it is **public domain or CC0**; then the object must be complete and truthful:
  `{ "url": "https://upload.wikimedia.org/...", "width": 960, "height": 720, "title": "File:...", "pageUrl": "https://commons.wikimedia.org/wiki/File:...", "license": "CC0", "author": "Name" }`.
  The app rejects any other host or license, so a guess breaks the import.
- Destination keys: `country` (`portugal`) or `country/city` (`portugal/lisbon`), lowercase ASCII with hyphens.

## 5. What makes a good itinerary

**Geography and time**
- Cluster each day in one area; avoid zig-zagging across the city. Put the day's first activity near the hotel base.
- Leave slack: arrival day (day 0) is light and local, departure day (last) is short and ends at the transfer. A realistic day has 3–5 activities and **never more than 6**.
- Check opening days and hours you know of (many museums close on Mondays or Tuesdays; some sights close in the afternoon). When unsure, say "check opening days" in `notes` rather than guess.
- Put outdoor and hiking items on days with room for weather changes; keep a flexible alternative in `notes` for weather-dependent days.
- Day trips: include the transfer legs there and back, and make the day long enough (`duration` of the trip item reflects the whole outing).
- Move between bases at a sensible time of day and never on the same day as a long, fixed-time activity.

**Content**
- Mix the headline sights with local food, a neighbourhood walk, and something unscheduled. Match the requested pace and interests.
- Group friendly: avoid items that only suit one kind of traveler unless the template is for that audience.
- Prefer widely documented, long-established places over trendy openings that may close. Do not include businesses you are not sure still exist.
- Do not mention prices, discounts, promo codes, or links.

**Accuracy and honesty**
- If you are not sure of a fact (hours, travel time, whether a transfer exists), **leave it vague or leave it out**; never invent. A wrong "9 minutes by metro" is worse than "short metro ride".
- Do not copy sentences from guidebooks, Wikipedia, Tripadvisor or blogs. Write original text. List real sources in `sources`.
- Neutral, plain English. No hype ("must-see!!!"), no second-person pressure.

## 6. Self-check before you answer

Go through this list and fix anything that fails **before** replying:

1. `format` and `version` exactly as specified; `templates` is an array.
2. Every template `id` is unique, lowercase-hyphen, and not reused for a different trip.
3. For each template: `sum(stays[].nights) == days - 1`; the first stay `start` is 0; each next stay starts where the last ended.
4. Every `day` is an integer from 0 to `days - 1`.
5. Every `type` and `transferType` is one of the allowed values, spelled exactly.
6. Every `time` is `HH:MM` (24-hour) or `""`; activities in a day are in time order.
7. Every `book` is `""` or starts with `Yes - `.
8. No day has more than 6 activities; arrival and departure days are light.
9. Every non-empty `place` is `country/slug`, and has an entry in `media.places`; every `destinationKeys` item and `hero` has an entry in `media.destinations`; `hero` is one of `destinationKeys`.
10. Every base in `stays` appears in `cities`; city names are English and written plainly.
11. There is an arrival leg on day 0, a leg for every move between bases, and a departure leg on the last day.
12. Descriptions are original, one or two sentences, and contain no prices or links.
13. All pictures are `null` / `[]` unless you verified a public-domain or CC0 Commons file.
14. The reply contains one JSON code block that is valid JSON.

## 7. If the import reports errors

The app lists problems like `activities.4.day: 9 is after the last day (6)` or `stays: nights add up to 5 but a 7-day trip has 6 nights`. Fix exactly those, keep everything else unchanged, and return the **complete corrected file**, not a patch. *Warnings* do not block the import; fix them if you can.
