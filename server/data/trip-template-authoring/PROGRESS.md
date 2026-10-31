# Template authoring progress

Live state of the bundle-authoring campaign over the destination list in `DESTINATIONS.md`.
**Update this file after every completed destination** so work can resume cleanly.

Last updated: 2026-10-29

---

## How to resume

Paste this to a fresh session:

> Read `server/data/trip-template-authoring/INSTRUCTIONS.md`, `example-bundle.json`,
> `DESTINATIONS.md` and `PROGRESS.md`. Continue the campaign from the next destination in
> the queue. Research with web search across several published itinerary sources, write the
> bundle, validate it with `node validate-bundle.mjs <file>` until it reports no errors,
> save it as `<country-slug>-bundle.json` in that same folder, and update `PROGRESS.md`.

### Per-destination recipe

1. Web-search 3+ independent published itineraries (guidebook publisher, official tourism
   board, major travel publication). Note length, bases, route, pace for each.
2. Pick 4–8 templates covering the most common lengths and routes. No two templates may
   share **both** length and the same set of bases.
3. Write the bundle. Geography per instructions 4.1: sovereign `countries`, state/province
   `regions`, base `cities`, and a `media.destinations` entry for every one of them.
4. `node validate-bundle.mjs <file>` → fix every ERROR. Warnings are optional but read them.
5. Save as `<country-slug>-bundle.json` here, tick it off below, commit nothing unless asked.
6. Match its activities to GetYourGuide tours: see `GETYOURGUIDE.md`.

---

## Done (3 of 91)

| # | Destination | File | Templates | Lengths | Notes |
|---|---|---|---|---|---|
| 1 | Brazil | `brazil-bundle.json` | 6 | 4, 7, 10, 10, 14, 14 | Rio / Sao Paulo / Iguazu / Salvador / Pantanal+Bonito / Amazon |
| 2 | United Kingdom — Scotland | `united-kingdom-scotland-bundle.json` | 6 | 4, 5, 7, 7, 10, 14 | Migrated from an earlier draft that wrongly used `countries: ["Scotland"]` |
| 3 | Japan | `japan-bundle.json` | 6 | 5, 7, 10, 10, 14, 14 | Tokyo / golden route / +Hakone+Nara / +Hiroshima / full circuit / Japan Alps via Kanazawa+Takayama |

## Queue

Ordered by how many well-documented published itineraries exist, which is what the
combining method in instructions 2.1 depends on.

### Next up
4. **Italy** — Rome / Florence / Venice, 7/10/14 d
5. **Peru** — Lima / Cusco / Machu Picchu / Sacred Valley, 7/10/14 d
6. **Egypt** — Cairo / Nile cruise / Luxor / Aswan, 8/10/12 d
7. **Thailand** — Bangkok / Chiang Mai / southern islands, 7/10/14 d
8. **Vietnam** — Hanoi / Ha Long / Hoi An / Ho Chi Minh City, 10/14 d
9. **Morocco** — Marrakesh / Fes / Sahara / Chefchaouen, 7/10 d
10. **India** — Golden Triangle + Kerala/Varanasi, 7/10/14 d
11. **Greece** — Athens + Cyclades, 7/10 d
12. **Spain** — Madrid / Barcelona / Andalusia, 7/10/14 d
13. **Iceland** — Ring Road + Golden Circle, 5/7/10 d
14. **Costa Rica** — San Jose / Arenal / Monteverde / coast, 7/10 d
15. **South Africa** — Cape Town / Garden Route / Kruger, 10/14 d
16. **Jordan** — Amman / Petra / Wadi Rum, 6/8 d
17. **Turkey** — Istanbul / Cappadocia / Aegean, 7/10 d
18. **New Zealand** — North + South Island, 10/14 d
19. **Australia** — Sydney / Cairns / Uluru / Melbourne, 10/14 d
20. **Argentina** — Buenos Aires / Patagonia / Iguazu, 10/14 d

### Remaining (not yet ordered)
Albania, Austria, Bahrain, Belgium, Belize, Bhutan, Bolivia, Botswana, Bulgaria, Cambodia,
Canada, Chile, China, Colombia, Croatia, Cyprus, Czech Republic, Denmark, Dominican
Republic, Ecuador, El Salvador, Eswatini, Ethiopia, Fiji, Finland, France, Germany,
Guatemala, Honduras, Hungary, Indonesia, Ireland, Kazakhstan, Kenya, Kosovo, Madagascar,
Malaysia, Maldives, Mauritius, Mexico, Montenegro, Mozambique, Namibia, Nepal,
Netherlands, North Macedonia, Norway, Panama, Philippines, Portugal, Qatar, Romania,
Rwanda, Saudi Arabia, Serbia, Singapore, Slovakia, South Korea, Sri Lanka, Sweden,
Switzerland, Tanzania, Tunisia, Uganda, United Arab Emirates, United Kingdom
(England / Northern Ireland), United States, Uzbekistan, Zimbabwe

---

## Conventions settled so far

Keep these consistent across bundles so the app's destination matching works.

- **File naming:** `<country-slug>-bundle.json`. When one country is split by region across
  several bundles, append the region: `united-kingdom-scotland-bundle.json`.
- **Template id:** `<country>-<route-shortname>-<days>d`, e.g. `brazil-rio-iguazu-7d`.
- **Place keys** are `<country-slug>/<place-slug>` and are **shared across templates and
  bundles** for the same country. Reuse the exact key when a later bundle revisits a place.
- **Destination keys** are `<country-slug>` and `<country-slug>/<region-or-city-slug>`.
  Where a region and its namesake city are the same name (Rio de Janeiro state and city,
  Sao Paulo state and city), they share one entry — the validator only warns about this.
- **Flights:** `legs` may not contain flights. For destinations where inter-city moves are
  by air, write two ground legs on the travel day (hotel → departure airport, arrival
  airport → hotel) and let the flight itself stay implied, as the `arrive`/`depart` fields
  already do for the international flight.
- **Accents** are fine in display text (`Foz do Iguaçu`) but keys stay ASCII
  (`brazil/foz-do-iguacu`).
- **Pictures** are always `"image": null` / `"images": []` — no Commons files verified yet.

## Gotchas found the hard way

- The **stay/leg boundary** is the easiest thing to get wrong on multi-base trips: a stay
  with `nights: n` starting on day `d` means the traveler leaves on day `d + n`, so the
  move-on leg belongs on `d + n`, not `d + n - 1`. The validator checks this; an ad-hoc
  eyeball check missed it on the Brazil 14-day template.
- **Activities within a day must be sorted by `time`** in array order, not just have valid
  times. Easy to break when inserting a stop into an existing day.
- `countries` must be the **sovereign** state. `["Scotland"]` is rejected; use
  `["United Kingdom"]` with `regions: ["Scotland"]`. The validator flags all four UK nations.
- A **day-trip stop** belongs in `cities` (and needs its own `media.destinations` entry and
  `destinationKeys` entry), not just in an activity's `where`. Otherwise a traveler who
  searches that place is never offered the template. Easy to forget when the same day trip
  is reused across several templates.
- For long bundles, write `<country>-media.json` and `<country>-templates-a/-b.json`
  separately and merge them with a short node script, then delete the parts. Writing one
  85 KB file in a single pass tends to hit the output limit mid-JSON.
- A **departure-day activity is optional**. Better to leave the last day with only the
  transfer than to invent a filler stop or repeat an earlier one.
