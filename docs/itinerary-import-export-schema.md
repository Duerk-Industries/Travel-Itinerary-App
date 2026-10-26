# Itinerary Import / Export — Schema Reference

**Status:** Describes behaviour as implemented on branch `UI-Tweaks-reloaded` (2026-10-26), plus specified-but-unbuilt behaviour.
**Audience:** engineers working on, or integrating with, trip import and export.
**Design background (not repeated here):**
[activity-lodging-import-export-architecture.md](activity-lodging-import-export-architecture.md) and
[implementation_plans/itinerary-document-import.md](implementation_plans/itinerary-document-import.md).
Where this file and those plans disagree, this file follows the code; see [§10](#10-known-gaps-and-plan-vs-code-drift).

**Implementation state.** Everything marked **[Spec 2026-10-26]** was specified and then built together on 2026-10-26: printout format v2 (§3), its lossless import (§4), the full CSV round trip, and CSV for ground transfers, car rentals and day-plan items (§5, §6). The tag now marks what that change added. The new CSV entities ship behind flags that default to off (§8). Where the build departs from the original spec, this file describes the build and §10 lists the difference.

---

## 1. Capability map

Four formats move trip data in or out of the app. They share no code path, so each has its own schema.

| # | Format | Direction | Entities | Entry point | Gate |
|---|---|---|---|---|---|
| A | **Printable itinerary** (HTML → browser print / PDF) | Export | Everything in §2.1 | `app/utils/printableItinerary.ts` | none |
| B | **Itinerary document import** (pasted text, PDF, markdown, image) | Import | Everything in §2.1 | `POST /api/trips/:tripId/import-document` | feature flag `itinerary_document_import` + Premium/Pro tier |
| C | **CSV import** | Import | Activities, lodging, ground transfers, car rentals, day-plan items **[Spec 2026-10-26]** (the last three) | `POST /api/activities/import`, `/api/lodgings/import`, `/api/transfers/import`, `/api/car-rentals/import`, `/api/itineraries/details/import` | `activity_lodging_csv_import`, plus one flag per new entity (§8) |
| D | **CSV export** | Export | Same entities as C | `CsvTransferControls` → `shareCsvFile` (client only) | `csv_export` and `activity_lodging_csv_export`, plus one flag per new entity |

A and B form a **round trip** for the whole itinerary: B detects A's output and reads it deterministically (no AI call). C and D form a second round trip for tabular entities. Use A/B to move a whole trip; use C/D to edit one list in a spreadsheet.

```
 trip data ──A──▶ printed PDF ──B──▶ trip (status per printout, new records only)
 trip data ──D──▶ CSV file    ──C──▶ trip (reviewed, create/update, idempotent)
```

---

## 2. Conventions shared by all formats

| Concept | Rule |
|---|---|
| Dates | Stored and exchanged as ISO `YYYY-MM-DD`. Format A prints long dates (`Monday, November 23, 2026`); B converts back. C also accepts `Mon DD` (see §5.3). |
| Times | Free text `HH:mm` (24h). Blank allowed for activities. |
| Money | Non-negative finite number, **no per-item currency**. Currency is a trip-level setting (`trip.currency`, default `USD`). |
| Item status | `Proposed → [Needs Booking] → Booked → Completed \| Cancelled`. `Needs Booking` is an optional stage that flags an item that must be booked ahead of time (for example a sell-out attraction), as opposed to a `Proposed` item that can be booked last minute. `Needed` is merged into `Proposed`: nothing is exported as `Needed`, and on import the legacy value `Needed` is read as `Proposed`. `Needs Booking` is preserved as itself. |
| Activity type | One of: `Class`, `Concert/Show`, `Day Trip`, `Event`, `Food & Drink`, `Fun & Games`, `Hike`, `Nightlife`, `Open Access`, `Outdoor Activity`, `Reservation`, `Shopping`, `Sights & Landmarks`, `Spa/Wellness`, `Ticketed Attraction`, `Tour`, `Other`. |
| Transfer type | `Flight`, `Public Transit`, `Private Transfer`, `Other`. Train, bus and ferry are `Public Transit`; a private car is `Private Transfer`. Format B and the CSV import write only these names; older stored records may still carry `Train`, `Bus`, `Ferry` or `Private`, and every reader treats those as their consolidated equivalent. |
| Day-plan item kind | `activity`, `place`, `note`, `checklist`. |
| Coordinate source | `catalog` \| `airport` \| `manual` \| `geocoder`. |
| People | Travelers are exchanged as **display names**, never IDs. On import, names are informational; assignment falls back to the trip's default travelers. |
| Never imported from a file | User IDs, owner IDs, trip IDs, image URLs, place IDs, votes, ratings, reactions. These come from the authenticated request. |
| Trust | Imported file content is data, never instructions. Server re-validates everything the client sends. |

### 2.1 Itinerary content inventory

This is the complete list of itinerary information. "Carried" means the format exports it (A, D) or restores it (B, C). **[Spec]** marks cells that are only true once the specified work ships. A dash means the format deliberately does not carry it.

| Content | Source fields | A prints | B restores | C / D |
|---|---|---|---|---|
| **Trip header** | `name`, `destination`/`locationIds` (as label), `startDate`, `endDate`, `currency`, `description` | yes | name/dates informational; `currency` only warns; `description` not overwritten | — |
| **Must-see list** | `mustSeeAttractions` | yes | appended to trip notes, not restored as a list | — |
| **Travelers** | trip members' names | yes | informational only | — |
| **Trip notes** | `Trip.notes` | **[Spec]** full text, before day 1 | **[Spec]** appended under a labelled section (§4.5) | — |
| **Trip guide** | `Itinerary.planMarkdown` (AI narrative) | **[Spec]** optional section after trip notes | **[Spec]** appended to trip notes under "Trip guide" | — |
| **Transfers** (flight, train, bus, ferry, transit, private, other) | type, status, dates, times, locations, airport codes, carrier, number, passengers, booking ref, layover, cost | yes (+ **[Spec]** status, explicit dates) | yes | ground transfers only **[Spec]**; flights excluded |
| **Lodging** | name, dates, address, rooms, status, refund-by, total, per night, coordinates, `notes`, `features` | yes (+ **[Spec]** notes, features) | yes (+ **[Spec]** notes, features) | yes (**[Spec]** full round trip) |
| **Activities** | name, type, status, date/time, location, duration, cost, free-cancel-by, booked-on, reference, notes, coordinates | yes (+ **[Spec]** booked-on, notes) | yes (+ **[Spec]**) | yes (**[Spec]** cost and full round trip) |
| **Optional activities** (undated) | activities with no date | **[Spec]** "Unscheduled" section after the last day | **[Spec]** | blank `Date` |
| **Car rentals** | vendor, vehicle, pick-up/drop-off date + place + coordinates, reference, prepaid, cost, notes, status | yes (+ **[Spec]** status) | yes | **[Spec]** |
| **Day-plan places** | title, time, cost, `placeId` → address, coordinates | yes (+ **[Spec]** address, coordinates) | yes (+ **[Spec]**) | **[Spec]** |
| **Day-plan notes** | title, time, cost, `noteBody` | title only today; **[Spec]** body in full | title only today; **[Spec]** body | **[Spec]** |
| **Day-plan checklists** | title, time, items (label, order, checked state) | label and ✓/□ | label (state **[Spec]**) | **[Spec]** |
| **Day-plan activities** | title, time, cost | yes | yes | **[Spec]** |
| **Item order within a day** | `position` (day-plan items), `dayPosition` (activities) | printed order | day-plan items: **[Spec]** printed order restored; activities keep time order (§10) | day-plan `Order` column; none for activities |
| **Expenses mirrored from items** | cost + payers | cost only | recreated by the normal insert path | recreated by commit |
| Votes, ratings, reactions | — | — | — | — |
| Payer/traveler IDs, owner IDs, images, place IDs | — | — | — | — |
| Packing lists, standalone expenses, chat, blog | separate features, own export (`userDataExport.ts`) | — | — | — |

### 2.2 Readability principles (Format A)

The printout is a document people read, print and carry, not a data dump. Every rule below is a hard requirement on the layout; the parser relies on the same rules, so readability and importability do not trade off.

1. **One fact per line**, as `Label value`. No field is encoded as punctuation inside prose.
2. **Chronological order:** days in order; within a day, scheduled items by time, then untimed items in their stored order. Everything else is grouped by kind in a fixed order (§3.2).
3. **Plain words for labels**, identical on screen, paper and in the parser (`Check-in`, not `check_in_date`). Labels never change between versions without a migration (§3.5).
4. **Empty is omitted.** A blank field prints no label; the parser treats absence as unknown.
5. **Long text is quoted**, one `> ` per line, so a paragraph of notes cannot be mistaken for the next item. The quote bar reads as ordinary quoted text.
6. **Nothing hidden.** There is no embedded JSON, no invisible text and no machine-only block. The only machine marker is a visible footer line (§3.5).
7. **Print-friendly:** each item avoids splitting across pages; each day starts a heading; checklists use ☐ and ☑ glyphs that survive black-and-white printing.

---

## 3. Format A — Printable itinerary (export)

Source: `buildPrintableItineraryHtml(input)` in [app/utils/printableItinerary.ts](../app/utils/printableItinerary.ts).
Output is a self-contained HTML document opened in a new window and sent to the browser's print dialog. Web only.

### 3.1 Input

```ts
type PrintableItineraryInput = {
  trip: Record<string, any>;          // name, currency, description, notes [Spec], mustSeeAttractions
  travelers?: Record<string, any>[];  // guestName | firstName+lastName | email
  locationLabel?: string | null;
  planMarkdown?: string | null;       // [Spec] Itinerary.planMarkdown, printed as "Trip guide"
  unscheduled?: Record<string, any>[];// [Spec] activities with no date
  days: Array<{
    date: string;                     // ISO
    dayNumber: number;
    flights?: Record<string, any>[];  // transfers of every type
    lodgings?: Record<string, any>[];
    tours?: Record<string, any>[];    // activities
    rentals?: Record<string, any>[];
    details?: Record<string, any>[];  // day-plan items (activity/place/note/checklist)
  }>;
};
```

### 3.2 Document layout

Implemented today:

```
<header class="cover">   "Travel itinerary" · trip name · first – last date [· locationLabel]
<div class="summary">    Trip length · Travelers · Currency
[trip.description] [Must-see: …]
<section class="day"> × N   "DAY n" + long date, then items in this order:
                              transfers → lodging → activities → car rentals → details
<section class="practical"> "Trip notes" boilerplate
<div class="footer">     "Printed from WanderBunnies · <date>"
```

**[Spec 2026-10-26] Format A v2 layout** (additions in bold):

```
<header class="cover">   "Travel itinerary" · trip name · first – last date [· locationLabel]
<div class="summary">    Trip length · Travelers · Currency
[trip.description] [Must-see: …]
**<section class="trip-notes">   "TRIP NOTES"  – Trip.notes, quoted, full text**
**<section class="trip-guide">   "TRIP GUIDE"  – planMarkdown, quoted, only when present**
<section class="day"> × N   "DAY n" + long date, then items in this order:
                              transfers → lodging → activities → car rentals → details
**<section class="unscheduled"> "UNSCHEDULED"  – activities with no date, same block layout**
<section class="practical"> **"Travel tips"** boilerplate     (renamed; see below)
<div class="footer">     "Printed from WanderBunnies · <date> **· Format v2**"
```

- The boilerplate section is renamed from **"Trip notes"** to **"Travel tips"**. With real trip notes now printed, two sections with the same title would be ambiguous to readers and to the parser. The parser ignores "Travel tips" and, for v1 printouts, ignores the old boilerplate "Trip notes" paragraph (its fixed sentence is recognised and skipped).
- A day with nothing scheduled prints `No scheduled items.`
- A booking that spans several days is **printed on every day it appears** (a flight on its departure and arrival days, a hotel on each night). Format B merges these back into one record.

### 3.3 Item blocks and their labelled fields

Each item prints `KIND` + heading, then `Label value` pairs. Empty values are omitted, so label presence is not guaranteed. Labels are the contract the importer reads (`wanderBunniesPrintParser.ts`), in this printed order. Labels marked **[Spec]** are added in v2 and are placed so v1 order is unchanged.

| Block kind | Heading | Labels (in order) |
|---|---|---|
| Transfer — `FLIGHT`, `TRAIN`, `BUS`, `FERRY`, `PUBLIC TRANSIT`, `PRIVATE TRANSFER`, `PRIVATE`, `OTHER`, `TRANSFER` | `{departure} → {arrival}` | `Carrier`, `Number`, `Departure` (`HH:mm · CODE`), `Arrival` (`HH:mm · CODE`), `Travelers`, `Booking reference`, `Layover`, `Layover duration`, `Cost`, **[Spec]** `Status`, **[Spec]** `Departure date`, **[Spec]** `Arrival date` |
| `ACCOMMODATION` | lodging name | `Check-in`, `Check-out`, `Address`, `Rooms`, `Status`, `Refund by`, `Total`, `Per night`, `Coordinates`, `Coordinate source`, **[Spec]** `Features`, **[Spec]** `Notes` (inline when one line, quoted when several) |
| `ACTIVITY` (booked item) | activity name | `Time`, `Location`, `Duration`, `Status`, `Category`, `Booking reference`, `Cost`, `Free cancellation by`, `Coordinates`, `Coordinate source`, **[Spec]** `Booked on`, **[Spec]** `Notes` (inline when one line, quoted when several) |
| `CAR RENTAL` | vendor, else model | `Vehicle`, `Pick up` (`date · place`), `Drop off` (`date · place`), `Reference`, `Prepaid`, `Cost`, `Pick-up coordinates`, `Drop-off coordinates`, `Coordinate source`, **[Spec]** `Status`, `Notes` |
| Detail — `ACTIVITY`, `PLACE`, `NOTE`, `CHECKLIST` | title | an optional time line and an optional `Cost: …` line, **[Spec]** `Address` and `Coordinates` (places), **[Spec]** quoted body (notes and places), checklist items (below) |

Formatting rules:

- Cost: `{CURRENCY} {n.nn}`, for example `USD 752.97`. Detail cost is printed without a currency.
- Coordinates: `lat, lng` to 5 decimals, only when both are finite and within ±90 / ±180. Flights never print coordinates (airport codes identify them).
- `Coordinate source` prints only when coordinates are present.
- `Features`: comma-separated tags, for example `Breakfast, Laundry`.
- Placeholders: `Time TBD`, `Location TBD`, `Departure`, `Arrival`, `Not specified`.
- All values are HTML-escaped.

**Quoted text [Spec 2026-10-26].** Trip notes, the trip guide and note bodies always print as quoted lines: every line is prefixed `> `, and a blank line is `>` alone. A `Notes` field on a lodging, activity or car rental prints inline like any other field when it is one line, and as a quote (the label `Notes` on its own line, then the quoted lines) when it has more than one:

```
NOTE  Booking priorities
> 1. Book the Shinkansen seats first.
> 2. Ryokan fills 3 months ahead.
>
> Cancel free until Nov 1.
```

The importer removes one leading `> ` (or `>`) per line and nothing else, so a note that itself contains `> ` survives a round trip. A line inside a quote is never interpreted as an item start, which fixes the v1 limit where a body could not be printed because its text might begin with a reserved word such as `FLIGHT`.

**Checklists [Spec 2026-10-26].** The time, when there is one, is a line of its own (as in every day-plan item); entries follow in stored order, one per line:

```
CHECKLIST  Before we leave
07:00
☐ Passports
☑ Book airport transfer
☐ Notify bank
```

`☑` = checked, `☐` = open. v1 printouts used `✓` and `□`; both pairs are accepted on import. Who checked an item is not printed (it is a user ID); on import, checked items are attributed to the importing user at import time.

**Places [Spec 2026-10-26].** A place detail prints its resolved `Address` and `Coordinates` (and `Coordinate source`) so the printout is usable without the app.

**Not carried by this format:** flight coordinates, per-person cost splits, per-item currency, votes, ratings, reactions, images, place IDs.

### 3.4 Worked example (v2, excerpt)

```
DAY 3   Wednesday, April 7, 2027

TRAIN  Tokyo Station → Kyoto Station
Carrier JR Tokaido Shinkansen   Number Nozomi 11
Departure 09:00 · Tokyo   Arrival 11:15 · Kyoto
Status Booked   Booking reference ABC123   Cost USD 140.00

ACCOMMODATION  Ryokan Yamashiro
Check-in Wednesday, April 7, 2027   Check-out Thursday, April 8, 2027
Address 12 Gion, Kyoto   Rooms 1   Status Proposed
Features Breakfast, Dinner
Notes Ask for a room with a private onsen.

ACTIVITY  Fushimi Inari shrine hike
Time 15:00   Location Fushimi, Kyoto   Duration 2h   Status Needs Booking   Category Hike
Booked on Klook
Notes
> Go early to avoid crowds.
> Closes at dusk.

CHECKLIST  Before dinner
☑ Reserve table
☐ Charge phone
```

### 3.5 Versioning and compatibility **[Spec 2026-10-26]**

- The footer reads `Printed from WanderBunnies · <date> · Format v2`. This is the only machine marker, and it is visible text.
- A printout is **v2** when the footer carries `Format v2`; otherwise it is **v1** (everything printed before this spec). v1 documents keep importing exactly as today.
- Parser rule: labels are additive. A reader that does not know a v2 label must skip the line, never fail. A label's meaning and order never change within a major version; reordering or renaming a label requires `Format v3` and a parser branch for the previous version.
- `isWanderBunniesPrint` keeps its existing three-part test. The version only selects which optional labels and the quote syntax are honoured.

---

## 4. Format B — Itinerary document import

### 4.1 Endpoints

| Method | Path | Success | Purpose |
|---|---|---|---|
| `POST` | `/api/trips/:tripId/import-document` | `202 { jobId, tripId, status }` | Validate, enqueue |
| `GET` | `/api/trips/:tripId/import-document/:jobId` | `200` job body | Poll |

The work runs as an in-memory async job because Firebase Hosting cuts `/api/**` rewrites at ~60 s. Only the entitlement check, upload and virus scan run inline.

**Request** — `multipart/form-data` (file) or JSON/form (text):

| Field | Type | Notes |
|---|---|---|
| `file` | file | Multipart only; PDF, markdown, text, image (OCR). Mutually exclusive with `documentText`. |
| `documentText` | string | Pasted text. |
| `sourceFilename` | string | Label for the notes section. Defaults to `pasted text`; replaced by the upload's original name when a file is sent. |
| `dryRun` | `true` \| `'true'` \| `'1'` | Preview without writing. |
| `x-correlation-id` | header | Optional; logged. |

**Poll response:**

```ts
{
  jobId: string;
  tripId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  error: string | null;
  result: ImportDocumentResult | null;   // see §4.4
  createdAt: string;                      // ISO
  updatedAt: string;
}
```

Jobs are scoped to `userId` + `tripId` (otherwise `404`), retained 24 h or 2000 entries (`DOCUMENT_IMPORT_JOB_RETENTION_*`), and **lost on process restart** (single-instance memory).

**Status codes:** `202` accepted · `400` no text/file, or other validation · `402` tier or entitlement denial (`{ error, code }`) · `403` not authorized for trip · `413` over character limit · ingestion errors use their own `httpStatus`.

### 4.2 Limits

| Limit | Value |
|---|---|
| Model-path document size | 60,000 characters |
| WanderBunnies printout size | 400,000 characters |
| Activity recovery chunk | 8,000 characters per dated-day group |
| Preview cache (`dryRun` → confirm) | 15 min TTL, 100 entries, keyed by `sha256(userId:text)` |
| Poll cadence (client) | 3 s, 5 min timeout |

### 4.3 Extraction schemas

Two extractors feed the same candidate shape.

1. **Deterministic** — `isWanderBunniesPrint(text)` is true when the text has `TRAVEL ITINERARY`, a `Printed from WanderBunnies` (or `saved in WanderBunnies`) footer, and a `DAY n <weekday>,` heading. `parseWanderBunniesPrint` then runs with no AI call, no cost, and identical output each time.
2. **Model** — any other document. The model must return exactly one JSON object:

```jsonc
{
  "candidates": [{
    "type": "flight|rail|ferry_bus_transfer|hotel|car_rental|tour_activity",
    "name": "text", "day": 1,
    "date": "YYYY-MM-DD|null", "endDate": "YYYY-MM-DD|null",
    "location": "text|null", "notes": "text|null", "sourceExcerpt": "source lines",
    "flight":  { "departureLocation": null, "arrivalLocation": null, "carrier": null,
                 "transferType": "Flight|Public Transit|Private Transfer|Other" },
    "hotel":   { "address": null },
    "carRental": { "pickupLocation": null, "dropoffLocation": null, "vendor": null },
    "activity": { "activityType": "<one of the activity types>", "startLocation": null }
  }],
  "dayNotes": [{ "day": 1, "date": "YYYY-MM-DD|null", "title": "label|null",
                 "body": "day-specific markdown", "sourceExcerpt": "source lines" }],
  "unassignedNotes": "trip-wide clean markdown"
}
```

The model is never asked for `status`. Dates must not be invented; missing is `null`.

**Candidate** (`ItineraryDocumentCandidate`, `itineraryDocumentImportService.ts`), the union both extractors emit:

| Group | Fields |
|---|---|
| Identity | `type` (required): `flight` \| `rail` \| `ferry_bus_transfer` \| `hotel` \| `car_rental` \| `tour_activity`; `name`, `providerVendor`, `confirmationNumber`, `day`, `sourceExcerpt` |
| Generic | `date`, `endDate`, `location`, `notes`, `totalCost`, `status`, `costPerNight`, `rooms` |
| Transfer | `departureDate`, `arrivalDate`, `departureLocation`, `arrivalLocation`, `departureTime`, `arrivalTime`, `carrier`, `flightNumber`, `travelerNames`, `layoverLocation`, `layoverDuration`, `flight{…}` |
| Lodging | `checkInDate`, `checkOutDate`, `address`, `refundBy`, `hotel{address}`; **[Spec]** `features: string[]` |
| Car rental | `pickupDate`, `dropoffDate`, `pickupLocation`, `dropoffLocation`, `vehicleType`, `prepaid`, `carRental{…}` |
| Activity | `activityDate`, `activityTime`, `duration`, `freeCancelBy`, `activity{activityType, startLocation}`; **[Spec]** `bookedOn` |
| Coordinates | `lat`, `lng`, `dropoffLat`, `dropoffLng`, `coordinateSource` |

**Day-plan detail** (`PrintedDetail`, printout path only). Implemented today:
`{ kind: 'activity'|'place'|'note'|'checklist', day, date, title, time: string|null, cost: number|null, checklist: string[] }`.

**[Spec 2026-10-26] extended `PrintedDetail`:**

```ts
type PrintedDetail = {
  kind: 'activity' | 'place' | 'note' | 'checklist';
  day: number | null;              // null for trip-level or unscheduled
  date: string | null;
  title: string;
  time: string | null;
  cost: number | null;
  body: string | null;             // note body / place description, quote bars removed
  address: string | null;          // place
  lat?: number | null; lng?: number | null;
  coordinateSource?: 'catalog' | 'airport' | 'manual' | 'geocoder';
  checklist: Array<{ label: string; checked: boolean }>;   // replaces string[]
  order: number;                   // position within the day, from order of appearance
};
```

`ExtractedItineraryDocument` gains `tripNotes: string | null` and `tripGuide: string | null`, read from the `TRIP NOTES` and `TRIP GUIDE` sections, and `unscheduled` candidates (activities with `date: null`).

**Printout field mapping** (what `parseWanderBunniesPrint` recovers):

| Printed | Becomes |
|---|---|
| `FLIGHT` | `flight` |
| `TRAIN` | `rail` (`transferType: Public Transit`) |
| `BUS`, `FERRY`, `PUBLIC TRANSIT`, `PRIVATE TRANSFER`, `PRIVATE`, `OTHER`, `TRANSFER` | `ferry_bus_transfer` with `transferType` `Public Transit`, `Public Transit`, `Public Transit`, `Private Transfer`, `Private Transfer`, `Other`, `Other` |
| `ACCOMMODATION` | `hotel` |
| `ACTIVITY` carrying `Status` and a tour label | `tour_activity` |
| `CAR RENTAL` | `car_rental` |
| `ACTIVITY`/`PLACE`/`NOTE`/`CHECKLIST` without those labels | `details[]` |
| Cover `Currency` | `currency` |
| `Category` | `activityType` if it is a known type, else `Other` |
| `Coordinates`, `Coordinate source` | `lat`/`lng`, `coordinateSource` (unrecognised source → `manual`; out-of-range values dropped) |
| **[Spec]** `TRIP NOTES` section | `tripNotes` |
| **[Spec]** `TRIP GUIDE` section | `tripGuide` |
| **[Spec]** `UNSCHEDULED` section | undated `tour_activity` candidates |
| **[Spec]** `Status` on a transfer or car rental | `status` (a recognised status; otherwise the default) |
| **[Spec]** `Departure date`, `Arrival date` | `departureDate`, `arrivalDate`; override the merge-derived value |
| **[Spec]** `Features` | `features` (split on `,`, trimmed, unique) |
| **[Spec]** `Notes` (inline when one line, quoted when several) | `notes` |
| **[Spec]** `Booked on` | `bookedOn` |
| **[Spec]** `☑` / `☐` (and v1 `✓` / `□`) | checklist item `checked` true / false |
| **[Spec]** `> ` quoted lines | text with one leading `> ` removed per line |
| **[Spec]** footer `Format v2` | selects v2 labels and quote syntax; absent means v1 |

**Merging.** A booking repeated on consecutive days becomes one record: transfers merge (up to two days for flights) with the last day as the arrival date; lodging and rentals are keyed by name + dates. Items keep the dates printed in the document, **not** the target trip's dates. Identical entries listed twice on one day are treated as one. In v2, explicit `Departure date` / `Arrival date` labels take precedence over the merge heuristic, so a layover or multi-day transfer no longer depends on adjacency.

### 4.4 Result schema

```ts
type ImportDocumentResult = {
  dryRun: boolean;
  added: Array<{ type: ItemType | 'day_note'; id: string | null; name: string; summary: string }>;
  skippedDuplicates: Array<{ type; name; summary; matchedExistingId: string; reason: string }>;
  skippedUnparseable: Array<{ type; name; summary; excerpt: string; reason: string }>;
  notesAppended: boolean;
  notesPreview: string | null;
  warnings?: string[];        // e.g. cover currency differs from the trip's
  usage: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
};
```

`id` is `null` in a dry run. `usage` is zero on the deterministic path. **[Spec]** `ItemType` gains `'note' | 'place' | 'checklist' | 'day_plan_activity'` for added day-plan items, so the preview lists them rather than silently dropping them.

### 4.5 Write rules

- Items are inserted through `insertFlight`, `insertLodging`, `insertActivity`, `insertCarRental`. Import **only adds**; it never modifies or removes an existing record.
- Printouts keep the status as printed. Model-extracted items land as `Proposed` (the design decision: a document the app has not seen must not assert a booking).
- `unassignedNotes` is **appended** to `Trip.notes` under a labelled section; nothing is overwritten and an empty result leaves no header:

  ```
  ### Imported from <sourceFilename> — <YYYY-MM-DD>

  <unassignedNotes>
  ```
- **[Spec]** `tripNotes` and `tripGuide` use the same append rule, as separate labelled sections:

  ```
  ### Imported from <sourceFilename> — <YYYY-MM-DD>
  <tripNotes>

  ### Trip guide (imported from <sourceFilename> — <YYYY-MM-DD>)
  <tripGuide>
  ```

  `tripGuide` is not written to `Itinerary.planMarkdown`: that field belongs to the AI pipeline and is regenerated by it. Importing the same document twice appends the sections twice (the structured items still dedupe); the preview shows this.
- **[Spec] Day-plan items** (`details`) are inserted into the trip's itinerary for the matching day (creating the itinerary record if the trip has none) in `order`:
  - `note` → kind `note`, `noteBody = body`.
  - `checklist` → kind `checklist`; items inserted in order with `checkedAt` set for checked items and `checkedBy` set to the importing user.
  - `place` → kind `place`. The importer does not call a places API. If `placeService` already has a cached place matching the address or coordinates it sets `placeId`; otherwise `placeId` stays null and the address and coordinates are appended to `noteBody` as `Address: …` / `Coordinates: …` so nothing is lost.
  - `activity` → kind `activity` with time and cost.
  - Duplicates: same `day` + `kind` + normalized `title` (and equal `time` when both present) is skipped and reported, as for activities.
- Imported activities keep time order. A custom in-day order (`dayPosition`) is not restored: `insertActivity` does not write it (§10). Day-plan items keep their printed order through `position`.
- Coordinates are saved afterwards via `setItemCoordinates(userId, kind, itemId, {lat, lng, source})` (lodging, activity, car rental), which checks trip membership. A failed save adds a warning and still adds the item without a pin.
- If the cover currency differs from `trip.currency`, a warning is returned. Amounts are imported as printed, not converted.

### 4.6 Duplicate detection (`findExistingTripItemMatches`)

Pure function over the trip's live records. Rules are intentionally loose:

| Type | Duplicate when |
|---|---|
| flight / rail / ferry_bus_transfer | departure date within ±1 day, **and** a normalized endpoint overlaps, **and** departure times agree or one is unknown |
| hotel | date ranges overlap **and** (a name token is shared **or** addresses overlap) |
| tour_activity | same date **and** names are substrings of each other (either direction), **and** start times agree or one is unknown (a morning and an evening visit are two) |
| car_rental | pickup date equal **and** vendor or pickup location overlaps |
| **[Spec]** day-plan item | same day + kind + normalized title, **and** equal time when both present |
| **[Spec]** unscheduled activity | normalized name is a substring of an existing undated activity's name, either direction |

### 4.7 Access control

`assertCanUseFeature(userId, 'itinerary_document_import', role)` runs before any normalization or provider spend. Feature flags have no admin bypass; tier entitlements do. Tier seeding: `free: false`, `premium: true`, `pro: true`. `Trip.notes` itself is not tier-gated, so a Free user can read and edit notes a collaborator imported.

---

## 5. Format C — CSV import

Each entity is a separate file and a separate commit; the entities never share a request. Supported entities: activities, lodging, and **[Spec 2026-10-26]** ground transfers, car rentals and day-plan items. **Ground transfers** are train, bus, ferry, public-transit and private-car legs. Flights are excluded: they keep coming from Format B or manual entry, because a flight row needs airport codes and carrier data the CSV path does not validate.

Two stages: the **client** parses and maps the file into reviewed rows (`app/utils/dataTransfer.ts`, `CsvTransferControls.tsx`); the **server** validates and commits (`server/src/routes/dataTransferRoutes.ts`).

### 5.1 File limits (client, before parsing)

| Limit | Value |
|---|---|
| File size | 2 MiB |
| Data rows | 150 |
| Columns | 50 |
| Cell length | 4,000 characters |
| Headers | no blanks, no duplicates (case-insensitive), BOM stripped |
| Parser | Papa Parse, `header: true`, `skipEmptyLines: 'greedy'` |

### 5.2 Header matching

Headers are normalized with `normalizeHeader`: strip BOM, trim, lowercase, delete `?`, collapse non-alphanumerics to a single space. Matching is exact against an alias set (no fuzzy matching). An unknown non-empty column is reported as *Ignored* and needs the user's acknowledgement; two columns mapping to one destination is a hard error.

**Activities**

| Destination | Accepted headers |
|---|---|
| `date` | `Date`, `Activity Date` |
| `activityType` | `Activity Type`, `Type`, `Category` |
| `lodgingLocation` | `Lodging Location`, `Base`, `Lodging` → appended to notes |
| `startTime` | `Start Time`, `Time` |
| `duration` | `Duration`, `Length` |
| `name` | `Activity Name`, `Name`, `Activity` |
| `notes` | `Activity Notes`, `Notes`, `Description` |
| `startLocation` | `Activity Start Address`, `Start Address`, `Address`, `Location` |
| `bookAhead` | `Book Ahead Required`, `Book Ahead`, `Requires Booking` → appended to notes |
| **[Spec]** `recordId` | `WanderBunnies Record ID` |
| **[Spec]** `recordFingerprint` | `WanderBunnies Record Fingerprint` |
| **[Spec]** `status` | `Status` |
| **[Spec]** `cost` | `Cost`, `Price` |
| **[Spec]** `bookedOn` | `Booked On` |
| **[Spec]** `reference` | `Booking Reference`, `Reference`, `Confirmation` |
| **[Spec]** `freeCancelBy` | `Free Cancellation By`, `Cancel By` |

**Lodging**

| Destination | Accepted headers |
|---|---|
| `checkInDate` | `Check In`, `Check-in`, `Check In Date` |
| `checkOutDate` | `Check Out`, `Check-out`, `Check Out Date` |
| `days` | `Days`, `Nights` (validation only) |
| `suggestedLocation` | `Suggested Location`, `Location`, `Area` |
| `name` | `Hotel`, `Lodging Name`, `Name` |
| `booked` | `Booked`, `Booked?` |
| `breakfast` / `dinner` / `laundry` | `Breakfast`, `Dinner`, `Laundry` (each with optional `?`) |
| `refundBy` | `Cancel By`, `Cancellation Date`, `Refund By` |
| `totalCost` | `Cost`, `Total Cost`, `Price` |
| `bookedOn` | `Booked On`, `Booking Source`, `Provider` → appended to notes |
| `address` | `Address`, `Hotel Address` |
| **[Spec]** `recordId`, `recordFingerprint` | as for activities |
| **[Spec]** `status` | `Status` (takes precedence over `Booked?`) |
| **[Spec]** `notes` | `Notes`, `Lodging Notes` |
| **[Spec]** `features` | `Features` (comma-separated tags) |
| **[Spec]** `rooms` | `Rooms` |

**Ground transfers [Spec 2026-10-26]**

| Destination | Accepted headers |
|---|---|
| `transferType` | `Transfer Type`, `Mode`, `Type` |
| `departureLocation` | `From`, `Departure Location`, `Origin` |
| `arrivalLocation` | `To`, `Arrival Location`, `Destination` |
| `departureDate` | `Date`, `Departure Date` |
| `departureTime` | `Departure Time`, `Depart`, `Start Time` |
| `arrivalDate` | `Arrival Date` |
| `arrivalTime` | `Arrival Time`, `Arrive` |
| `carrier` | `Carrier`, `Operator`, `Line` |
| `flightNumber` | `Service Number`, `Train Number`, `Number` (stored in the existing transfer column; printed as `Number`) |
| `cost` | `Cost`, `Price` |
| `reference` | `Booking Reference`, `Reference`, `Confirmation` |
| `recordId`, `recordFingerprint`, `status` | as for activities |

`Departure` and `Arrival` are deliberately **not** aliases: the printout uses those labels for `HH:mm · CODE` values, and accepting them here would make a pasted printout table parse with times in the location columns. Stored transfers have no notes field, so there are no `Notes`, `Duration` or `Book Ahead Required` aliases here; such a column in an incoming file is shown as *Ignored* (§10).

**Car rentals [Spec 2026-10-26]**

| Destination | Accepted headers |
|---|---|
| `vendor` | `Vendor`, `Company`, `Rental Company` |
| `model` | `Vehicle`, `Car`, `Model` |
| `pickupDate` | `Pick Up Date`, `Pickup Date` |
| `pickupLocation` | `Pick Up Location`, `Pickup Location`, `Pick Up` |
| `dropoffDate` | `Drop Off Date`, `Dropoff Date` |
| `dropoffLocation` | `Drop Off Location`, `Dropoff Location`, `Drop Off` |
| `prepaid` | `Prepaid` |
| `cost` | `Cost`, `Price` |
| `reference` | `Reference`, `Booking Reference`, `Confirmation` |
| `notes` | `Notes`, `Description` |
| `recordId`, `recordFingerprint`, `status` | as for activities |

**Day-plan items [Spec 2026-10-26]** — the notes, checklists, places and custom activities attached to a day

| Destination | Accepted headers |
|---|---|
| `date` | `Date`, `Day` (a date; a bare day number `1`–`999` is resolved against the trip start) |
| `kind` | `Kind`, `Item Type`, `Type` — `Activity`, `Place`, `Note`, `Checklist` (case-insensitive) |
| `time` | `Time`, `Start Time` |
| `title` | `Title`, `Name` |
| `cost` | `Cost`, `Price` |
| `body` | `Body`, `Note`, `Notes`, `Description` |
| `checklist` | `Checklist Items`, `Checklist`, `Items` — one item per line inside the cell, each starting `[x] ` (checked) or `[ ] ` (open) |
| `address` | `Address`, `Location` |
| `coordinates` | `Coordinates` (`lat, lng`) |
| `order` | `Order`, `Day Order` |
| `recordId`, `recordFingerprint` | as for activities |

### 5.3 Value parsing

| Value | Rule |
|---|---|
| Date | Strict ISO `YYYY-MM-DD`, or an English `[Weekday,] Mon DD[, YYYY]`. Without a year, candidate years across the trip's range are tried and **exactly one in-range result** is accepted (handles November → January rollover). Zero or several candidates is an error on that row. `new Date(string)` is never used. |
| Money | Strip `$`, `,`, whitespace; must be finite and ≥ 0, otherwise `0`. No currency inference. |
| Activity type | Alias map below; unknown becomes `Other` with a warning. |
| Lodging features | `Yes`/`True` or any non-`No`/`False` value adds the tag (`Breakfast`, `Dinner`, `Laundry`); qualifiers such as `$9/per` or `Near` are also kept in notes as `Breakfast: $9/per`. **[Spec]** A `Features` column is split on `,`, trimmed and de-duplicated, and merged with the tags above. |
| Lodging name | `Hotel`; if blank, `Lodging in {Suggested Location}`. |
| Lodging notes | Joined lines: `Suggested location: …`, `Booked via: …`, feature qualifiers. **[Spec]** A `Notes` column value comes first. |
| Activity notes | `Notes` plus `Lodging location: …` and `Book ahead required: …`. |
| **[Spec]** Status | A recognised status (`Proposed`, `Needs Booking`, `Booked`, `Completed`, `Cancelled`, case-insensitive; legacy `Needed` is read as `Proposed`); anything else is a warning and the default applies. A `Book Ahead Required` value does not set the status; it stays a note (see below), so a user who wants the flag sets `Needs Booking` in the `Status` column or in the review screen. |
| **[Spec]** Order | Positive integer or blank. Blank keeps the file order. |
| **[Spec]** Coordinates | `lat, lng` within ±90 / ±180; invalid values are a row warning and ignored. Source is recorded as `manual`. |

**Ground transfer values [Spec 2026-10-26]:**

| Value | Rule |
|---|---|
| `transferType` | Case-insensitive alias map to the app's consolidated transfer types: `Train`, `Rail`, `Shinkansen`, `Bullet Train`, `Limited Express`, `Express`, `Bus`, `Highway Bus`, `Coach`, `Ferry`, `Boat`, `Subway`, `Metro`, `Tram`, `Public Transit`, `Local Transit` → `Public Transit`; `Taxi`, `Shuttle`, `Car Service`, `Private Transfer`, `Private` → `Private Transfer`; `Other` → `Other`. `Flight`, `Plane`, `Air` are an **error** on the row (*use document import or add the flight manually*); a blank type is an error; anything else becomes `Other` with a warning. |
| Dates | Same parser as activities (ISO, or `Mon DD` resolved against the trip range). `arrivalDate` defaults to `departureDate` when blank. |
| Times | `HH:mm` (24h) or blank. Anything else is an error on that field. |
| Ordering | When both ends have a time, `arrivalDate + arrivalTime` must be later than `departureDate + departureTime`; an overnight leg must therefore carry an `arrivalDate`. With either time blank, only `arrivalDate >= departureDate` is checked. |
| Cost | Money rule above. Imported, like activity cost. |

**Day-plan item values [Spec 2026-10-26]:** `title` is required; `kind` is required and must be one of the four; a `Checklist` row needs at least one item; `Note` rows put `body` in `noteBody`; `Place` rows put `address` and `coordinates` in `noteBody` exactly as in §4.5 (no places API call on import); a row with no resolvable `date` is an error. Checklist cell syntax: items separated by a newline inside the quoted cell; a line without a `[x] `/`[ ] ` prefix is an open item.

Activity type aliases: `Food/Drink` → `Food & Drink`; `Temple/Shrine`, `Castle`, `Garden`, `Museum`, `Neighborhood`, `Sightseeing` → `Sights & Landmarks`; `Hike` → `Hike`; `Market` → `Shopping`; `Onsen/Ryokan` → `Spa/Wellness`; `Free/Buffer` → `Open Access`. Canonical type names pass through unchanged.

**Defaults** set on every parsed row: activities `status: 'Proposed'` and `cost` as parsed **[Spec]** (v1 hard-codes `0`); ground transfers and car rentals `status: 'Proposed'` and `cost` as parsed (else `0`) **[Spec]**; lodging `status` = `Booked` when `Booked?` is `Yes`, else `Proposed`; `rooms` as parsed **[Spec]** (v1: `1`); `costPerNight = totalCost / nights` (derived from dates, never from `Days`). A `Days` value that differs from the computed nights only warns.

### 5.4 Review row (client-internal)

```ts
type ImportReviewRow<TFields> = {
  sourceRow: number;                 // 1-based line in the file; first data row is 2
  action: 'create' | 'update' | 'skip';
  existingId?: string;
  expectedFingerprint?: string;
  fields: TFields;
  warnings: ImportIssue[];
  errors: ImportIssue[];             // any error blocks commit until fixed or the row is skipped
};
type ImportIssue = { row?: number; field?: string; severity: 'error' | 'warning'; message: string };
```

Duplicate suggestion on open: a row whose key exactly matches an existing record defaults to `skip` with `existingId` and `expectedFingerprint` set. Keys are `name|date|startTime|startLocation` (activities), `name|checkInDate|checkOutDate|address` (lodging), `transferType|departureDate|departureTime|departureLocation|arrivalLocation` (ground transfers; no name field), `vendor|pickupDate|pickupLocation` (car rentals) and `date|kind|title|time` (day-plan items) **[Spec 2026-10-26]**; matches are consumed one-to-one so legitimate repeat rows survive.

**[Spec 2026-10-26] Record ID matching.** When a file carries `WanderBunnies Record ID`:

1. If the ID belongs to an existing record **in this trip**, the row is matched to it (`existingId`), ahead of the key match.
2. If the row's `WanderBunnies Record Fingerprint` equals the record's current fingerprint and the other fields are unchanged, the row defaults to `skip`.
3. If any importable field differs, the row is marked **Changed**, defaults to `skip`, and the review screen offers **Update**. Choosing it sets `action: 'update'` with `expectedFingerprint` = the record's *current* fingerprint (the one read when the review opened), so a collaborator's edit in between still returns `409`.
4. An ID from another trip, or unknown, is ignored (the row falls back to the key match, then to `create`). IDs are never trusted without the server's membership and fingerprint checks.

### 5.5 Commit request

`POST /api/activities/import`, `POST /api/lodgings/import`, and **[Spec 2026-10-26]** `POST /api/transfers/import`, `POST /api/car-rentals/import`, `POST /api/itineraries/details/import`. JSON body ≤ **256 KiB**, authenticated.

```jsonc
{
  "tripId":   "<uuid>",
  "importId": "<uuid>",            // client-generated; the idempotency key
  "rows": [                         // 1–150; skipped rows are not sent
    {
      "sourceRow": 2,               // positive int, unique within the request
      "action": "create",           // "create" | "update"
      "existingId": "<id>",         // required for update, forbidden for create; unique per request
      "expectedFingerprint": "…",   // optional; concurrency check for update
      "fields": { /* allow-listed keys below */ }
    }
  ]
}
```

The envelope and each row are `.strict()`: unknown keys are rejected with `422`/`400` via Zod. `fields` accepts **only** these keys:

| Entity | Allowed `fields` keys |
|---|---|
| Activity | `status`, `activityType`, `date`, `name`, `startLocation`, `startTime`, `duration`, `cost`, `freeCancelBy`, `bookedOn`, `reference`, `notes`, `paidBy`, `travelerIds` |
| Lodging | `status`, `name`, `checkInDate`, `checkOutDate`, `rooms`, `refundBy`, `totalCost`, `costPerNight`, `address`, `notes`, `features`, `paidBy`, `travelerIds` |
| Ground transfer **[Spec 2026-10-26]** | `status`, `transferType`, `departureDate`, `departureTime`, `arrivalDate`, `arrivalTime`, `departureLocation`, `arrivalLocation`, `carrier`, `flightNumber`, `cost`, `reference`, `paidBy`, `travelerIds` |
| Car rental **[Spec 2026-10-26]** | `status`, `vendor`, `model`, `pickupDate`, `pickupLocation`, `dropoffDate`, `dropoffLocation`, `prepaid`, `cost`, `reference`, `notes`, `paidBy`, `travelerIds` |
| Day-plan item **[Spec 2026-10-26]** | `kind`, `date`, `time`, `title`, `cost`, `body`, `address`, `lat`, `lng`, `checklist` (array of `{ label, checked }`), `position` |

A day-plan row's `address`, `lat` and `lng` are written into the item's body text, not as a map pin (§5.5 *Writes*). A fingerprint mismatch on an update is a `422` row error (*Record changed since review*).

**Server-side validation** (violations collected per row, returned together):

| Rule | Activities | Lodging | Ground transfers **[Spec]** |
|---|---|---|---|
| Required | `name`; `date` optional but must be valid ISO if present | `name`, `checkInDate`, `checkOutDate`; check-out strictly after check-in | `transferType` (not `Flight`), `departureLocation`, `arrivalLocation`, `departureDate`; ordering rule in §5.3 |
| Numbers | `cost` finite ≥ 0 | `totalCost`, `costPerNight` finite ≥ 0 | `cost` finite ≥ 0 |
| `update` | needs `existingId`; record must belong to `tripId` | same | same; the existing record must not be a `Flight` |
| `create` | must not carry `existingId` | same | same |
| Fingerprint | `name,date,startTime,startLocation,notes` | `name,checkInDate,checkOutDate,address,notes` | `transferType,departureDate,departureTime,departureLocation,arrivalLocation` |

| Rule **[Spec 2026-10-26]** | Car rentals | Day-plan items |
|---|---|---|
| Required | `pickupDate`, `dropoffDate`, `pickupLocation`; drop-off on or after pick-up | `kind`, `title`, valid `date` inside the trip's itinerary range; checklist rows need ≥ 1 item |
| Numbers | `cost` finite ≥ 0 | `cost` finite ≥ 0 when present; `position` positive integer |
| Fingerprint | `vendor,pickupDate,pickupLocation,dropoffDate,notes` | `date,kind,title,time,body` |

Fingerprint = `JSON.stringify` of the listed fields, each `String(v ?? '').trim().toLowerCase()`. A mismatch means the record changed since review.

Writes: `status` is normalised (default `Proposed`; the old `Needed` is read as `Proposed`); `activityType` defaults to `Other`; `travelerIds` default to all trip group members (lodging: to `paidBy` if given, else all members; transfers: every member becomes a passenger); lodging `rooms` is at least 1; lodging `imageUrl` is `null`.

- **Create** inserts a new record. **Update** changes only the fields the request carries: the route builds its patch from the keys present, so a CSV without a `Cost` or `Status` column never resets them, and the client likewise sends only the columns the file had.
- Ground transfers **[Spec 2026-10-26]** are written through the existing `insertFlight` / `updateFlight` adapter functions with the transfer type set, so they appear wherever transfers already render. A blank time is stored as `00:00`, as the transfers route does; the fingerprint and the export treat `00:00` as blank. An update that targets a flight is rejected.
- Car rentals use `insertCarRental` / `updateCarRental`. Day-plan items use `addItineraryDetail` / `updateItineraryDetail`, create the trip's itinerary record when it has none, and need the trip to have a start date (a row's date becomes a trip day). A place's address and coordinates are written into the item's body (`Address: …`, `Coordinates: …`); no places API is called. Checked checklist entries are marked checked by the person importing.
- Each row also upserts its expense mirror: `sourceType` `activity`, `lodging`, `flight` (ground transfers) or `car_rental`; an activity with no date deletes its mirror. Day-plan items create no expenses, matching current app behaviour.
- The car-rental import also requires the `car_rentals` tier entitlement, like the Car Rentals tab.

### 5.6 Commit response and status codes

```jsonc
// 201 Created (or 200 with the stored body on an exact replay)
{ "importId": "<uuid>", "created": 3, "updated": 1, "records": [ /* saved entities */ ] }
```

| Status | Meaning |
|---|---|
| `201` / `200` | Committed / replay of a prior identical request |
| `400` / `422` | DTO shape invalid / `{ error, rows: [{ sourceRow, error }] }` row validation failures, nothing written |
| `402` | Entitlement denied (`{ error, code }`) |
| `403` | Caller is not a member of the trip |
| `404` | Feature flag disabled (`FEATURE_DISABLED`) |
| `409` | `importId` reused with a different payload |
| `429` | HTTP burst limit (with `Retry-After`) or daily API-usage cap |
| `500` | Unexpected failure; error is logged without row data |

### 5.7 Idempotency, limits and metering

- Receipt keyed by `(userId, tripId, entity, importId)` storing `sha256(JSON.stringify(dto))` and the response. Postgres/memory: table `data_transfer_imports`; Firestore: collection `data_transfer_imports`; other providers fall back to an in-process map. Receipts older than 24 h are pruned from the in-process map.
- Per-user/IP HTTP burst limiter (`reserveDataTransferRateLimit`), then one API-usage unit per accepted row via `reserveApiUsageOrThrow({ provider: 'DATA_TRANSFER_API', requireConfiguredLimit: true })`.
- `server/config/api-limits.yaml` → `DATA_TRANSFER_API`: 24 h window, overall 20,000; callers `ACTIVITY_IMPORT_ROWS` 15,000 and `LODGING_IMPORT_ROWS` 5,000. **[Spec 2026-10-26]** Add `TRANSFER_IMPORT_ROWS` 5,000, `CAR_RENTAL_IMPORT_ROWS` 2,000 and `DAY_PLAN_IMPORT_ROWS` 5,000. The overall 20,000 cap is unchanged; it is shared.
- Logging is structured `[data-transfer] entity=… result=… rows=… durationMs=…`; CSV contents, notes and addresses are never logged.

---

## 6. Format D — CSV export

Client-only: `CsvTransferControls.exportCsv` builds the file from the rows already loaded in the tab, then `shareCsvFile` (web download via Blob; native share sheet via `expo-file-system` `File` + `expo-sharing`).

### 6.1 Columns

**Activities** (`activities-YYYY-MM-DD.csv`)

| # | Header | Source field | Re-imports? |
|---|---|---|---|
| 1 | `WanderBunnies Record ID` | `id` | v1 no (*Ignored*); **[Spec]** yes (§5.4) |
| 2 | `WanderBunnies Record Fingerprint` | fingerprint of `name,date,startTime,startLocation,notes` | v1 no; **[Spec]** yes |
| 3 | `Date` | `date` (blank for an unscheduled activity) | yes |
| 4 | `Activity Type` | `activityType` | yes |
| 5 | `Start Time` | `startTime` | yes |
| 6 | `Duration` | `duration` | yes |
| 7 | `Activity Name` | `name` | yes |
| 8 | `Activity Notes` | `notes` | yes |
| 9 | `Activity Start Address` | `startLocation` | yes |
| 10 | `Status` | `status` | v1 no; **[Spec]** yes |
| 11 | `Cost` | `cost` | v1 no; **[Spec]** yes |
| 12 **[Spec]** | `Booked On` | `bookedOn` | yes |
| 13 **[Spec]** | `Booking Reference` | `reference` | yes |
| 14 **[Spec]** | `Free Cancellation By` | `freeCancelBy` | yes |

**Lodging** (`lodgings-YYYY-MM-DD.csv`)

| # | Header | Source field | Re-imports? |
|---|---|---|---|
| 1 | `WanderBunnies Record ID` | `id` | v1 no; **[Spec]** yes |
| 2 | `WanderBunnies Record Fingerprint` | fingerprint of `name,checkInDate,checkOutDate,address,notes` | v1 no; **[Spec]** yes |
| 3 | `Check In` | `checkInDate` | yes |
| 4 | `Check Out` | `checkOutDate` | yes |
| 5 | `Hotel` | `name` | yes |
| 6 | `Booked?` | booked indicator | yes |
| 7 | `Cancel By` | `refundBy` | yes |
| 8 | `Cost` | `totalCost` | yes |
| 9 | `Address` | `address` | yes |
| 10 | `Notes` | `notes` | v1 no; **[Spec]** yes |
| 11 | `Features` | `features` | v1 no; **[Spec]** yes |
| 12 | `Rooms` | `rooms` | v1 no; **[Spec]** yes |
| 13 **[Spec]** | `Status` | `status` | yes |

**Ground transfers [Spec 2026-10-26]** (`transfers-YYYY-MM-DD.csv`)

Exports every transfer on the trip whose `transferType` is not `Flight`, sorted by `departureDate`, then `departureTime` (blank last), then `departureLocation`. Flights are left out because Format C rejects them (§5.3).

| # | Header | Source field | Re-imports? |
|---|---|---|---|
| 1 | `WanderBunnies Record ID` | `id` | yes (§5.4) |
| 2 | `WanderBunnies Record Fingerprint` | fingerprint of `transferType,departureDate,departureTime,departureLocation,arrivalLocation` | yes |
| 3 | `Date` | `departureDate` | yes |
| 4 | `Transfer Type` | `transferType` | yes |
| 5 | `From` | `departureLocation` | yes |
| 6 | `To` | `arrivalLocation` | yes |
| 7 | `Departure Time` | `departureTime` | yes |
| 8 | `Arrival Date` | `arrivalDate` | yes |
| 9 | `Arrival Time` | `arrivalTime` | yes |
| 10 | `Carrier` | `carrier` | yes |
| 11 | `Service Number` | `flightNumber` | yes |
| 12 | `Cost` | `cost` | yes |
| 13 | `Booking Reference` | `bookingReference` | yes |
| 14 | `Status` | `status` | yes |

Columns 3–13 use the first-listed alias of each §5.2 destination, so an exported file re-imports without a column-mapping step. There is no notes column because stored transfers have no notes. A stored `00:00` time (how a blank time is saved) is exported blank.

**Car rentals [Spec 2026-10-26]** (`car-rentals-YYYY-MM-DD.csv`), sorted by `pickupDate`

| # | Header | Source field |
|---|---|---|
| 1 | `WanderBunnies Record ID` | `id` |
| 2 | `WanderBunnies Record Fingerprint` | fingerprint of `vendor,pickupDate,pickupLocation,dropoffDate,notes` |
| 3 | `Vendor` | `vendor` |
| 4 | `Vehicle` | `model` |
| 5 | `Pick Up Date` | `pickupDate` |
| 6 | `Pick Up Location` | `pickupLocation` |
| 7 | `Drop Off Date` | `dropoffDate` |
| 8 | `Drop Off Location` | `dropoffLocation` |
| 9 | `Prepaid` | `prepaid` |
| 10 | `Cost` | `cost` |
| 11 | `Reference` | `reference` |
| 12 | `Notes` | `notes` |
| 13 | `Status` | `status` |

**Day-plan items [Spec 2026-10-26]** (`day-plan-YYYY-MM-DD.csv`), sorted by `date`, then `position`

| # | Header | Source field |
|---|---|---|
| 1 | `WanderBunnies Record ID` | detail `id` |
| 2 | `WanderBunnies Record Fingerprint` | fingerprint of `date,kind,title,time,body` |
| 3 | `Date` | the day's date |
| 4 | `Kind` | `Activity`, `Place`, `Note` or `Checklist` |
| 5 | `Time` | `time` |
| 6 | `Title` | `activity` (the detail's title) |
| 7 | `Cost` | `cost` |
| 8 | `Body` | `noteBody` |
| 9 | `Checklist Items` | one line per item, `[x] label` or `[ ] label`, in `position` order |
| 10 | `Address` | a place's address; blank for stored items, which keep it in the body (§10) |
| 11 | `Coordinates` | `lat, lng`; blank for stored items, as above |
| 12 | `Order` | `position` |

The `Body` and `Checklist Items` cells contain real line breaks inside a quoted cell; spreadsheet apps display them as wrapped text. The 4,000-character cell limit applies on import; a longer body is exported whole and the file is then rejected on re-import (§10).

### 6.2 Serialization

`toCsv(headers, rows)` in `app/utils/dataTransfer.ts`:

- UTF-8 with a leading BOM (`﻿`), CRLF line endings, trailing CRLF.
- Cells containing `"`, `,`, CR or LF are quoted; `"` is doubled.
- **Formula-injection guard:** a text cell whose first non-whitespace character is `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`. Import does not strip this prefix.
- Not exported: payer/traveler assignments (internal IDs), image URLs, votes, ratings, owner IDs, flights (from the transfers file) **[Spec 2026-10-26]**.

---

## 7. Round-trip guarantees **[Spec 2026-10-26]**

These are the testable promises once the specified work ships. Each is an automated test (§11).

| Guarantee | Meaning |
|---|---|
| **A → B is lossless for portable content** | Printing a trip as Format A v2 and importing it into an empty copy of the trip reproduces every field marked "A prints" and "B restores" in §2.1, apart from fields the format excludes by design. Statuses are kept; IDs, attribution and reactions are not. |
| **B is idempotent for structured items** | Importing the same printout twice adds no new bookings, day-plan items or unscheduled activities. Only the labelled notes sections are appended again (§4.5). |
| **v1 printouts still import** | The v1 fixture in `wanderBunniesPrintImport.test.ts` yields the same candidates after the v2 parser lands. |
| **D → C is lossless for importable columns** | Exporting a list and importing the file unchanged into the same trip yields only `skip` rows and zero warnings. Editing a cell yields a **Changed** row that offers **Update**. |
| **Text survives** | Notes, note bodies, checklist labels and the `Notes` columns round-trip exactly, including line breaks, quotes, commas and a leading `> `. A value that begins with `=`, `+`, `-` or `@` gains one protective apostrophe on export; on re-import it shows as *Changed* instead of being silently stripped. |
| **Human check** | A v2 printout renders every populated field as a visible, labelled line (§2.2). A snapshot test fails if a populated field is missing from the HTML. |

---

## 8. Feature flags, tiers and configuration

| Key | Where | Default | Controls |
|---|---|---|---|
| `itinerary_document_import` | `feature-flags.yaml` + tier entitlement | flag enabled; free ✗, premium ✓, pro ✓ | Format B |
| `activity_lodging_csv_import` | `feature-flags.yaml` | enabled | Format C (checked server-side via `assertCanUseFeature`) |
| `ground_transfer_csv_import` **[Spec 2026-10-26]** | `feature-flags.yaml` | off by default; enable to release | Ground transfer rows in Format C; also requires `activity_lodging_csv_import` |
| `car_rental_csv_import` **[Spec 2026-10-26]** | `feature-flags.yaml` | off by default; enable to release | Car rental rows in Format C; also requires `activity_lodging_csv_import` |
| `day_plan_csv_import` **[Spec 2026-10-26]** | `feature-flags.yaml` | off by default; enable to release | Day-plan rows in Format C; also requires `activity_lodging_csv_import` |
| `activity_lodging_csv_export` | `feature-flags.yaml` | enabled | Format D, together with master `csv_export` |
| `ground_transfer_csv_export`, `car_rental_csv_export`, `day_plan_csv_export` **[Spec 2026-10-26]** | `feature-flags.yaml` | off by default; enable to release | The matching export file in Format D, together with master `csv_export` |
| `csv_export` | `feature-flags.yaml` | enabled | Master export switch |
| `DATA_TRANSFER_API` | `api-limits.yaml` | see §5.7 | Row metering for Format C |

The three new CSV import flags each also need `activity_lodging_csv_import`, and each export flag also needs `csv_export`. Car-rental import additionally needs the `car_rentals` tier entitlement. `/api/auth/features` reports the combined result (`featureGroundTransferCsvImport`, `…Export`, `featureCarRentalCsv…`, `featureDayPlanCsv…`).

Format A v2 has no flag: it changes what an existing, ungated button prints. Format B's v2 parsing rides on `itinerary_document_import`.

Feature flags have no admin bypass; tier limits and entitlements do. Entitlement checks fail open on a missing row (see CLAUDE.md).

---

## 9. Related stored fields

| Field | Defined | Notes |
|---|---|---|
| `Trip.notes?: string \| null` | `server/src/types.ts` | Written by `PATCH /api/trips/:id` (`notes` alongside `description`) and by Format B appends. Surfaced as "Notes" on Overview. **[Spec]** Printed by Format A v2. |
| `Itinerary.planMarkdown?: string \| null` | `server/src/types.ts` | AI narrative. **[Spec]** Printed as "Trip guide"; never written by import. |
| `ItineraryDetail` (`kind`, `noteBody`, `placeId`, `position`, `checklistItems[]`) | `server/src/types.ts` | The day-plan items in §2.1. |
| `ItineraryChecklistItem` (`label`, `position`, `checkedBy`, `checkedAt`) | `server/src/types.ts` | `checkedBy` is not exported; `checkedAt` becomes the ☑/☐ state. |
| `Lodging.notes?: string \| null`, `Lodging.features: string[]` | `server/src/types.ts` | Added so CSV import loses no lodging context. Postgres: `features JSONB NOT NULL DEFAULT '[]'`. |
| `Activity.dayPosition`, `Activity.dayOrderPinned` | `server/src/types.ts` | In-day order. Not carried by import or export (§10). |
| `ActivityType` includes `Other` | `server/src/types.ts` | Safe fallback for unknown types. |
| Item coordinates + source | adapter fn `setItemCoordinates` | Postgres/memory and Firestore; used by Format B. |
| `data_transfer_imports` | migration `20260822_add_data_transfer_imports.sql` | Idempotency receipts (Format C). |

---

## 10. Known gaps and plan-vs-code drift

Checked against the code on 2026-10-26. Items marked **Decision** need an owner to choose which side moves.

1. **Resolved — `Needed` merged into `Proposed`; `Needs Booking` stays.** Blank/`No` in `Booked?` and the activity default both give `Proposed`, as the code does. The architecture doc ([activity-lodging-import-export-architecture.md](activity-lodging-import-export-architecture.md)) still says `Needed` in several places and should be updated to match. `server/src/utils/itineraryStatus.ts` already reads `Needed` as `Proposed` and keeps `Needs Booking`; the CSV importer (`parseStatus`) does the same.
   **Open question:** `Book Ahead Required` in a CSV still becomes a note only. Mapping a non-empty value to `Needs Booking` would use the stage as intended, but would change imported status, so it is left as a decision.
2. **Resolved — CSV round trip for activities and lodging.** Record ID, Record Fingerprint, Status, activity Cost, Booked On, Booking Reference and Free Cancellation By (activities), and Notes, Features, Rooms and Status (lodging) now re-import. A Record ID from this trip links a row to its record: unchanged rows default to Skip, edited rows are marked *Changed* (and skip until included, which makes them updates). The export's lodging fingerprint used to omit `notes` while the server's included it; both now use the same keys (`app/utils/dataTransfer.ts` `FINGERPRINT_KEYS`, `server/src/utils/dataTransferFingerprint.ts`).
3. **Resolved — activity `Cost` is imported.**
4. **Atomicity.** The doc promises all-or-nothing commits in one DB transaction. The route validates all rows first (so validation failures write nothing), but then saves rows one at a time; an infrastructure failure part-way through can leave earlier rows written with no receipt.
5. **Idempotency claim.** The doc describes a durable in-progress claim with lease. The route checks for an existing receipt and writes it after success, so two simultaneous requests with the same `importId` can both pass the check. (Reusing an `importId` with a different body now answers `409` as documented; it used to surface as a `500`.)
6. **Quota ordering.** Usage units are reserved after validation but before writes, as designed; there is no refund if the later writes fail.
7. **Format B jobs are in-memory.** A restart or a second Cloud Run instance loses or cannot see the job (single-instance only).
8. **Resolved — the printout is no longer lossy** for trip notes, note bodies, lodging and activity notes and features, activity booked-on, transfer status and explicit dates, unscheduled activities, place addresses and checklist state (§3, §4). Still not carried: flight coordinates, per-person cost splits, per-item currency, and who ticked a checklist entry.
9. **Single currency.** No format carries per-item currency; Format B only warns on a cover-currency mismatch.
10. **Resolved — CSV for ground transfers, car rentals and day-plan items is built** (routes, DTOs, alias tables, review rows, export, tab controls, flags and API-limit callers), off by default. It departs from the original spec in these ways:
    - **Transfer types follow the app's consolidated set** (`Public Transit`, `Private Transfer`, `Other`) in both the CSV and Format B: rail, bus, ferry, subway and tram all become `Public Transit`. Older stored `Train`/`Bus`/`Ferry`/`Private` records are read as their consolidated equivalents.
    - **Transfers have no notes field**, so the transfer CSV has no `Notes`, `Duration` or `Book Ahead Required` columns; such a column in an incoming file is shown as *Ignored*. The transfer fingerprint has no notes.
    - **Transfer locations keep their case.** `insertFlight` and `updateFlight` (Postgres) used to upper-case every location; they now upper-case only a three-letter airport code (`nrt` becomes `NRT`), so `Tokyo Station` is stored and exported as typed. Records saved before this change stay upper-case until edited; the fingerprint and the Changed check ignore case, so they still match.
    - **Activity `Order` (`dayPosition`) is not carried by any format.** `insertActivity` does not write it, and the reorder call needs a whole day's current order. Imported activities keep time order. Day-plan `Order` (`position`) is carried.
    - **Day-plan updates** change title, time, cost, body, day and order. They do not edit checklist entries. A stored day-plan item has no address or coordinates of its own (they live in the body text), so those two export columns are blank; they are still read on import.
    - **A fingerprint mismatch answers `422`** with the row error *Record changed since review*, not `409`.
    - **Long text is not truncated on export.** A day-plan body over 4,000 characters is exported whole and then rejected by the import's cell-length limit.
11. **Export versioning.** The printout carries a visible `Format v2` footer marker (§3.5). CSV stays unversioned: its header row is its schema, and new columns are appended at the end of each table.
12. **Checklist attribution is not portable.** `checkedBy` is a user ID, so imported checked items are attributed to the importing user.
13. **Places are not re-resolved on import.** A place detail keeps its address and coordinates in `noteBody` unless the places cache already has a match. Calling a places API on import is deliberately out of scope (cost and quota).
14. **Resolved — "Trip notes" boilerplate renamed** to "Travel tips" in the printout (§3.2), so it cannot be confused with the real trip notes. Format B ignores both names.
15. **Format B day-plan and notes restoration needs a printout.** A document that is not a WanderBunnies printout still goes through the model path, which returns candidates, day notes and unassigned notes only; checklist state, place addresses and unscheduled activities are not recovered from arbitrary documents.

---

## 11. Tests

| Test | Where |
|---|---|
| Printout v2 layout, and an end-to-end round trip: the HTML is turned into text the way a PDF extractor would and parsed back (trip notes and guide, unscheduled activity, transfer dates and status, lodging features and notes, rental notes, note body starting with a reserved word, checklist state, place address) | `app/tests/printableItineraryRoundTrip.test.ts` |
| v2 parser: version, trip notes and guide, explicit transfer dates, quoted notes, features, booked-on, checklist state, place address, unscheduled section, Travel tips boilerplate; v1 fixture unchanged | `server/__tests__/wanderBunniesPrintImport.test.ts` |
| v2 import: notes, features, booked-on, status, undated activity, note bodies, checked entries, trip notes and guide appended without touching existing notes, preview lists kinds and writes nothing | same |
| CSV round trip for all five entities (export, then import: no errors, no ignored columns, every row Skip), edited row offered as an update that sends only the columns the file had, Record ID from another trip ignored, statuses, flights refused, time and ordering rules, `00:00` as blank, legacy `Train` matches `Public Transit`, checklist cells | `app/tests/dataTransferEntities.test.ts` (and the existing `dataTransfer.test.ts`, `csvExport.test.ts`) |
| Import routes for all five entities: flags off by default, creates, partial updates, stale-fingerprint rejection, flights refused, validation, idempotent replay and `409` on reuse, unknown field and non-member rejected | `server/__tests__/data-transfer-routes.test.ts` (passes on pg-mem and on the Firestore emulator) |

Not covered by automated tests: the tab buttons and review dialog for the three new entities (the control is shared and covered for activities and lodging by `analyticsTaskTracking.test.tsx`), and a full Firestore run of the other suites after this change.

---

## 12. Where to change things

| Change | Touch |
|---|---|
| New field on the printout | `printableItinerary.ts` render fn + `*_LABELS` and field mapping in `wanderBunniesPrintParser.ts` (labels are order-sensitive; add new labels at the end of the block, §3.5) + candidate type + tests in `wanderBunniesPrintImport.test.ts`, `printableItineraryRoundTrip.test.ts` |
| New CSV column | alias table, review-row builder, `canonicalRecord`, `EXPORT_HEADERS` and `toExportRows` in `app/utils/dataTransfer.ts`; the field list in `server/src/routes/dataTransferDtos.ts` and the entity's `validate` / `save` in `dataTransferRoutes.ts`; append new export columns at the end |
| New importable entity | an `EntityConfig` in `dataTransferRoutes.ts` plus its field list in `dataTransferDtos.ts`, its fingerprint in `server/src/utils/dataTransferFingerprint.ts` (and the matching `canonicalRecord` / `FINGERPRINT_KEYS` in `dataTransfer.ts`), an `api-limits.yaml` caller, import and export flags in `feature-flags.yaml`, the `/api/auth/features` keys in `webAuthRoutes.ts`, the state and props in `App.tsx`, and a `CsvTransferControls` in the entity's tab |
| New extractor candidate type | `ItineraryDocumentCandidateType`, system prompt, `findExistingTripItemMatches`, the write branch in `importItineraryDocument` |

Tests: `server/__tests__/itineraryDocumentImportService*.test.ts`, `document-import-async.test.ts`, `wanderBunniesPrintImport.test.ts`, `data-transfer-routes.test.ts`, `item-coordinates.test.ts`; `app/tests/csvExport.test.ts`, `dataTransfer.test.ts`, `dataTransferEntities.test.ts`, `printableItinerary.test.ts`, `printableItineraryRoundTrip.test.ts`, `itineraryDocumentImportVisibility.test.ts`.
