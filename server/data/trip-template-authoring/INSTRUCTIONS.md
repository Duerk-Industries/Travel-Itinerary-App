# WanderBunnies sample itinerary authoring — instructions for an LLM

You are writing **sample itineraries** ("templates") for WanderBunnies, a group trip-planning app. A traveler who picks a destination is offered these as worked examples: a day-by-day plan with a hotel area per stay, activities, and the ground transfers between cities. The traveler can turn one into a trip and then change anything, so every item is a *suggestion*.

You work **outside the app**. Your only output is **one JSON file** (a "bundle") that an administrator downloads from you and imports into WanderBunnies. The app checks the file strictly and rejects anything that does not follow the rules below, so follow them exactly.

---

## 1. How a person uses these instructions

1. Give an LLM this whole document, plus `example-bundle.json` (a complete valid bundle) and, if you have it, `schema.json` (the same format as JSON Schema).
2. Tell it what you want. **The only thing you must give it is a destination.** For example:

   > Using the instructions, create itineraries for **Scotland**.

   The LLM then researches the destination and decides which itineraries to write (section 2). You may add anything that narrows it down, and it will use that to choose which source itineraries to draw on: a length ("7 and 10 days"), a time of year ("September"), a pace ("relaxed"), interests ("food and history"), cities or a region ("Highlands only"), or how travelers arrive. For example:

   > Using the instructions, create itineraries for **Portugal**: relaxed pace, food and history, around 5 to 10 days, in spring.

3. To **change an existing itinerary**, first download the current templates from *Admin → Itinerary templates → Download templates*, give that file to the LLM, and ask for the change. Keep each template's `id` the same and it will be imported as an *update*; a new `id` is imported as a *new* template.
4. Save the LLM's JSON as a `.json` file and import it from *Admin → Itinerary templates → Import*. The app first shows a **preview** (new / updated / unchanged, plus any errors to fix) and only saves when the whole file is acceptable. If there are errors, paste the error list back to the LLM and ask it to return the corrected full file.

## 2. How to decide what to write

The request may be as short as a destination. **Do not stop to ask questions**: work out what is missing, make reasonable assumptions, and list them at the top of your reply (outside the JSON). Ask only if there is no destination, or it is so ambiguous you cannot tell which place is meant.

What the request can contain, and the default when it does not:

| Input | If not given |
|---|---|
| **Destination** (a country or region). Required. | Ask. |
| **Length** in days (2 to 21 is typical; the app allows up to 60). Day 1 is arrival, the last day is departure. | Use the lengths that are most common among the sources (step 3 below). |
| **Time of year** (affects what is open, weather, daylight). | Write for the main travel season of the destination, and say which. |
| **Pace and interests.** Pace is relaxed, balanced or fast. Interests come from the fixed list in section 4.6 (history and art map to `culture`, nature and hiking to `outdoors`; there is no tag for family). | Whatever the most common itineraries do; tag it honestly (section 4.6). |
| **Cities or region to cover**, and **how travelers arrive and leave** (airport or station). | The most common bases and entry points among the sources. |
| Whether this **updates** an existing template (use its `id`) or is **new**. | New. |

Do not ask about prices: templates carry no costs.

### 2.1 Method: combine the common itineraries into generic ones

Do these steps in order. The aim is **generic itineraries that reflect what most good itineraries for the destination have in common**, not a rewrite of any one of them.

1. **Find the sources.** Identify the ten most useful and widely used travel sites and guides that publish itineraries for the destination: for example guidebook publishers, the official tourism board, and major travel publications and trip-planning sites. Prefer well-established ones with named, sample itineraries by length. If you can browse, open their itineraries for this destination. **If you cannot browse, say so at the top of your reply and work from what you reliably know**; do not pretend to have read pages you have not.
2. **Tabulate them.** For every source itinerary you use, note its length in days, its bases (where the traveler sleeps), its route, its stops, and its pace. Keep this note short; it is for your own reasoning and for the summary in step 7.
3. **Find what recurs.** Count which lengths appear most often, which route shapes (the order of bases) appear most often, and which stops are included by most itineraries for each route.
4. **Choose the set.** Create itineraries for the **most common lengths and routes**, usually 4 to 8 templates, never more than 12. Several templates of the **same length are fine when their destinations (bases) differ**, and several **lengths are fine when the destinations are the same**; but no two templates may have both the same length and the same bases. Cover the destination's main regions rather than five variations of one trip.
5. **Apply what the admin asked for.** If the request gives a length, a time of year, a pace, interests or a region, use it to **choose and weight the source itineraries** you combine: keep the ones that fit, give them more weight, and drop the rest. Reflect it in the result: the template's `pace` and `interests`, the stops chosen, and seasonal advice (leave out what is closed or unpleasant in that season, or say "check opening days" in `notes`).
6. **Combine, then write it generically.** For each template, keep the stops and transfers that most of the relevant source itineraries share, put them in a sensible geographic order, and space them at a realistic pace (section 5). Drop one-off, trendy or promotional items. Then write the whole thing **in your own words**, with no source's name, wording or branding in the text. Facts (a place exists, how long a train takes) are fine to reuse; sentences, a source's distinctive list of stops in its exact order, and its descriptions are not. If a template would end up matching a single source almost exactly, blend in more of the others or change the route.
7. **Fill in everything, not only the plan.** For every template and every place, write the descriptions and assign the tags as this document describes: each place needs `description` and `details` (4.5) and `interests` and `mobility` (4.6), and each template needs `pace` and `interests`. Leave a `details` as `""`, or a tag out, only when you cannot do it without guessing; do not guess to fill a gap.
8. **Say what you did, briefly, above the JSON:** which sources you used (or that you could not browse), which lengths and routes recurred, which itineraries you created and why those, and any assumptions. Keep it to a short list; it is for the administrator and is not imported.

In `sources`, list only the publishers and sites you actually used or know well enough to have used; never invent a site, title or link.

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
| `sources` | string[] | Where you got the facts (guidebook names, official tourism sites). **Internal: for maintainers only, never shown to travelers or copied into a trip**, so keep source names out of every other field. Be honest; leave empty rather than invent. |
| `pace` | string | Optional. How full the days are: `"R"` relaxed, `"B"` balanced, `"F"` fast. Internal tag, never shown to travelers (4.6). |
| `interests` | string[] | Optional. What the whole plan is about, from the fixed list in 4.6. Internal tag, never shown. |
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
"portugal/belem-tower": {
  "name": "Belém Tower",
  "description": "A small fortified tower on the Tagus riverbank that once guarded the city's harbour.",
  "details": "A paragraph of 3 to 5 sentences ...",
  "interests": ["culture", "iconic_landmarks", "photography"],
  "mobility": "M",
  "image": null
}
```

`media.destinations[key]` for the country and each city:

```json
"portugal/lisbon": { "name": "Lisbon", "description": "A hilly riverside capital of tiled façades, trams and ...", "images": [] }
```

- `description`: **one sentence (under 300 characters)** saying what the place *is* and why people go. Written by you, in your own words. This is the short version: travelers see it while the stop is only being offered (suggestions, the "Add activity" menu, the template preview).
- `details`: **one paragraph of 3 to 5 sentences (under 1,000 characters)**, the full version of the same description. Once the stop is added to a trip it becomes the first line of the activity's notes, so it is also what the traveler's trip export shows. Same rules as everywhere: original words, nothing you are unsure of, no prices, no opening hours or ticket rules unless you are certain (otherwise say "check opening days"), no links. Say what the place is, a little of its background that is well documented, and one practical thing about visiting. It must agree with `description` and add to it, not repeat it. Leave `""` if you cannot write it without guessing; the app then uses the sentence. `details` requires a `description`.
- `interests` and `mobility`: internal tags for the stop (see 4.6). Optional, never shown to travelers.
- **Pictures: leave `"image": null` and `"images": []`.** Pictures are added later by a maintainer who can check licenses. Only include a picture if you can open the Wikimedia Commons file page and confirm it is **public domain or CC0**; then the object must be complete and truthful:
  `{ "url": "https://upload.wikimedia.org/...", "width": 960, "height": 720, "title": "File:...", "pageUrl": "https://commons.wikimedia.org/wiki/File:...", "license": "CC0", "author": "Name" }`.
  The app rejects any other host or license, so a guess breaks the import.
- Destination keys: `country` (`portugal`) or `country/city` (`portugal/lisbon`), lowercase ASCII with hyphens.

### 4.6 Internal tags: `pace`, `interests`, `mobility`

These describe the template and each stop so the app can match them to a traveler's preferences. **They are never shown to travelers, and they are never copied into a trip or its export.** They use the same fixed vocabulary as the app's AI itinerary generator, so use these exact values and no others (anything else is rejected). All of them are optional: leave a tag out rather than guess.

| Tag | Where | Values |
|---|---|---|
| `pace` | template | `R` relaxed (few stops, long breaks), `B` balanced, `F` fast (many stops, little slack) |
| `interests` | template and each place | any of `outdoors`, `adventure`, `culture`, `food`, `nightlife`, `relax`, `photography`, `authentic_local`, `iconic_landmarks` |
| `mobility` | each place | `L`, `M` or `H`: the mobility a traveler needs for this stop (`L` = easy, mostly flat or step-free; `M` = some steps, hills or longer walks; `H` = steep, long or uneven) |

- Tag a stop from what it is and what you wrote about it (a castle on a hill with steps is `M`; a park path you described as steep is `H`). Do not tag from reputation alone.
- Use two to four interests for a stop, and the few that define the plan for the template (usually 3 to 5). Match the pace to what was asked and to how full the days actually are.

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
- The paragraph in `details` is longer, so it is easier to slip: do not add a date, a number, a name or a claim to fill it out. A shorter paragraph of things you are sure of is better than a longer one with a guess in it.
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
12. Descriptions are original, one sentence, and contain no prices or links. Each `details` is one paragraph, agrees with its description, and states nothing you are unsure of (or is `""`).
12a. `pace`, `interests` and `mobility` use only the values in 4.6, and every template and place has them (unless you truly cannot say).
12b. No two templates share both length and bases; the set follows the most common lengths and routes you found, and any length, season, pace, interests or region the request gave.
12c. Nothing is copied from a source: no sentences, no source names in descriptions, no list that reproduces one source's itinerary.
13. All pictures are `null` / `[]` unless you verified a public-domain or CC0 Commons file.
14. The reply contains one JSON code block that is valid JSON.

## 7. If the import reports errors

The app lists problems like `activities.4.day: 9 is after the last day (6)` or `stays: nights add up to 5 but a 7-day trip has 6 nights`. Fix exactly those, keep everything else unchanged, and return the **complete corrected file**, not a patch. *Warnings* do not block the import; fix them if you can.
