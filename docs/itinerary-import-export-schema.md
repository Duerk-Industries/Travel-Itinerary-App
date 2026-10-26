# Itinerary Import / Export — Schema Reference

**Status:** Describes behaviour as implemented on branch `UI-Tweaks-reloaded` (2026-10-26).
**Audience:** engineers working on, or integrating with, trip import and export.
**Design background (not repeated here):**
[activity-lodging-import-export-architecture.md](activity-lodging-import-export-architecture.md) and
[implementation_plans/itinerary-document-import.md](implementation_plans/itinerary-document-import.md).
Where this file and those plans disagree, this file follows the code; see [§9](#9-known-gaps-and-plan-vs-code-drift).

---

## 1. Capability map

Four formats move trip data in or out of the app. They share no code path, so each has its own schema.

| # | Format | Direction | Entities | Entry point | Gate |
|---|---|---|---|---|---|
| A | **Printable itinerary** (HTML → browser print / PDF) | Export | Flights/transfers, lodging, activities, car rentals, day-plan details | `app/utils/printableItinerary.ts` | none |
| B | **Itinerary document import** (pasted text, PDF, markdown, image) | Import | Transfers, lodging, activities, car rentals, day notes, trip notes | `POST /api/trips/:tripId/import-document` | feature flag `itinerary_document_import` + Premium/Pro tier |
| C | **Activities / Lodging CSV import** | Import | Activities, lodging | `POST /api/activities/import`, `POST /api/lodgings/import` | feature flag `activity_lodging_csv_import` |
| D | **Activities / Lodging CSV export** | Export | Activities, lodging | `CsvTransferControls` → `shareCsvFile` (client only) | flags `csv_export` and `activity_lodging_csv_export` |

A and B form a **round trip**: B detects A's output and reads it deterministically (no AI call). C and D form a second round trip, limited to activities and lodging.

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
| Item status | `Needed → Proposed → Booked → Completed \| Cancelled` (`server/src/utils/itineraryStatus.ts`; printout parser also accepts `Needs Booking`). |
| Activity type | One of: `Class`, `Concert/Show`, `Day Trip`, `Event`, `Food & Drink`, `Fun & Games`, `Hike`, `Nightlife`, `Open Access`, `Outdoor Activity`, `Reservation`, `Shopping`, `Sights & Landmarks`, `Spa/Wellness`, `Ticketed Attraction`, `Tour`, `Other`. |
| Coordinate source | `catalog` \| `airport` \| `manual` \| `geocoder`. |
| Never imported from a file | User IDs, owner IDs, trip IDs, image URLs, place IDs, votes, ratings. These come from the authenticated request. |
| Trust | Imported file content is data, never instructions. Server re-validates everything the client sends. |

---

## 3. Format A — Printable itinerary (export)

Source: `buildPrintableItineraryHtml(input)` in [app/utils/printableItinerary.ts](../app/utils/printableItinerary.ts).
Output is a self-contained HTML document opened in a new window and sent to the browser's print dialog. Web only.

### 3.1 Input

```ts
type PrintableItineraryInput = {
  trip: Record<string, any>;          // name, currency, description, mustSeeAttractions
  travelers?: Record<string, any>[];  // guestName | firstName+lastName | email
  locationLabel?: string | null;
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

```
<header class="cover">   "Travel itinerary" · trip name · first – last date [· locationLabel]
<div class="summary">    Trip length · Travelers · Currency
[trip.description] [Must-see: …]
<section class="day"> × N   "DAY n" + long date, then items in this order:
                              transfers → lodging → activities → car rentals → details
<section class="practical"> "Trip notes" boilerplate
<div class="footer">     "Printed from WanderBunnies · <date>"
```

A booking that spans several days is **printed on every day it appears** (a flight on its departure and arrival days, a hotel on each night). Format B merges these back into one record.

### 3.3 Item blocks and their labelled fields

Each item prints `KIND` + heading, then `Label value` pairs. Empty values are omitted, so label presence is not guaranteed. Labels are the contract the importer reads (`wanderBunniesPrintParser.ts`), in this printed order:

| Block kind | Heading | Labels (in order) |
|---|---|---|
| Transfer — `FLIGHT`, `TRAIN`, `BUS`, `FERRY`, `PUBLIC TRANSIT`, `PRIVATE TRANSFER`, `PRIVATE`, `OTHER`, `TRANSFER` | `{departure} → {arrival}` | `Carrier`, `Number`, `Departure` (`HH:mm · CODE`), `Arrival` (`HH:mm · CODE`), `Travelers`, `Booking reference`, `Layover`, `Layover duration`, `Cost` |
| `ACCOMMODATION` | lodging name | `Check-in`, `Check-out`, `Address`, `Rooms`, `Status`, `Refund by`, `Total`, `Per night`, `Coordinates`, `Coordinate source` |
| `ACTIVITY` (booked item) | activity name | `Time`, `Location`, `Duration`, `Status`, `Category`, `Booking reference`, `Cost`, `Free cancellation by`, `Coordinates`, `Coordinate source` |
| `CAR RENTAL` | vendor, else model | `Vehicle`, `Pick up` (`date · place`), `Drop off` (`date · place`), `Reference`, `Prepaid`, `Cost`, `Pick-up coordinates`, `Drop-off coordinates`, `Coordinate source`, `Notes` |
| Detail — `ACTIVITY`, `PLACE`, `NOTE`, `CHECKLIST` | title | optional time line, optional `Cost: …`, checklist as `✓`/`□ label` list |

Formatting rules:

- Cost: `{CURRENCY} {n.nn}`, for example `USD 752.97`. Detail cost is printed without a currency.
- Coordinates: `lat, lng` to 5 decimals, only when both are finite and within ±90 / ±180. Flights never print coordinates (airport codes identify them).
- `Coordinate source` prints only when coordinates are present.
- Placeholders: `Time TBD`, `Location TBD`, `Departure`, `Arrival`, `Not specified`.
- All values are HTML-escaped.

**Not carried by this format:** flight coordinates, per-person cost splits, note bodies (title only), votes, ratings, images, per-item currency.

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
                 "transferType": "Flight|Train|Bus|Ferry|Other" },
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
| Lodging | `checkInDate`, `checkOutDate`, `address`, `refundBy`, `hotel{address}` |
| Car rental | `pickupDate`, `dropoffDate`, `pickupLocation`, `dropoffLocation`, `vehicleType`, `prepaid`, `carRental{…}` |
| Activity | `activityDate`, `activityTime`, `duration`, `freeCancelBy`, `activity{activityType, startLocation}` |
| Coordinates | `lat`, `lng`, `dropoffLat`, `dropoffLng`, `coordinateSource` |

**Day-plan detail** (`PrintedDetail`, printout path only):
`{ kind: 'activity'|'place'|'note'|'checklist', day, date, title, time: string|null, cost: number|null, checklist: string[] }`.

**Printout field mapping** (what `parseWanderBunniesPrint` recovers):

| Printed | Becomes |
|---|---|
| `FLIGHT` | `flight` |
| `TRAIN` | `rail` (`transferType: Train`) |
| `BUS`, `FERRY`, `PUBLIC TRANSIT`, `PRIVATE TRANSFER`, `PRIVATE`, `OTHER`, `TRANSFER` | `ferry_bus_transfer` with `transferType` `Bus`, `Ferry`, `Public Transit`, `Private Transfer`, `Private`, `Other`, `Other` |
| `ACCOMMODATION` | `hotel` |
| `ACTIVITY` carrying `Status` and a tour label | `tour_activity` |
| `CAR RENTAL` | `car_rental` |
| `ACTIVITY`/`PLACE`/`NOTE`/`CHECKLIST` without those labels | `details[]` |
| Cover `Currency` | `currency` |
| `Category` | `activityType` if it is a known type, else `Other` |
| `Coordinates`, `Coordinate source` | `lat`/`lng`, `coordinateSource` (unrecognised source → `manual`; out-of-range values dropped) |

**Merging.** A booking repeated on consecutive days becomes one record: transfers merge (up to two days for flights) with the last day as the arrival date; lodging and rentals are keyed by name + dates. Items keep the dates printed in the document, **not** the target trip's dates. Identical entries listed twice on one day are treated as one.

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

`id` is `null` in a dry run. `usage` is zero on the deterministic path.

### 4.5 Write rules

- Items are inserted through `insertFlight`, `insertLodging`, `insertActivity`, `insertCarRental`. Import **only adds**; it never modifies or removes an existing record.
- Printouts keep the status as printed. Model-extracted items land as `Proposed` (the design decision: a document the app has not seen must not assert a booking).
- `unassignedNotes` is **appended** to `Trip.notes` under a labelled section; nothing is overwritten and an empty result leaves no header:

  ```
  ### Imported from <sourceFilename> — <YYYY-MM-DD>

  <unassignedNotes>
  ```
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

### 4.7 Access control

`assertCanUseFeature(userId, 'itinerary_document_import', role)` runs before any normalization or provider spend. Feature flags have no admin bypass; tier entitlements do. Tier seeding: `free: false`, `premium: true`, `pro: true`. `Trip.notes` itself is not tier-gated, so a Free user can read and edit notes a collaborator imported.

---

## 5. Format C — Activities / Lodging CSV import

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

### 5.3 Value parsing

| Value | Rule |
|---|---|
| Date | Strict ISO `YYYY-MM-DD`, or an English `[Weekday,] Mon DD[, YYYY]`. Without a year, candidate years across the trip's range are tried and **exactly one in-range result** is accepted (handles November → January rollover). Zero or several candidates is an error on that row. `new Date(string)` is never used. |
| Money | Strip `$`, `,`, whitespace; must be finite and ≥ 0, otherwise `0`. No currency inference. |
| Activity type | Alias map below; unknown becomes `Other` with a warning. |
| Lodging features | `Yes`/`True` or any non-`No`/`False` value adds the tag (`Breakfast`, `Dinner`, `Laundry`); qualifiers such as `$9/per` or `Near` are also kept in notes as `Breakfast: $9/per`. |
| Lodging name | `Hotel`; if blank, `Lodging in {Suggested Location}`. |
| Lodging notes | Joined lines: `Suggested location: …`, `Booked via: …`, feature qualifiers. |
| Activity notes | `Notes` plus `Lodging location: …` and `Book ahead required: …`. |

Activity type aliases: `Food/Drink` → `Food & Drink`; `Temple/Shrine`, `Castle`, `Garden`, `Museum`, `Neighborhood`, `Sightseeing` → `Sights & Landmarks`; `Hike` → `Hike`; `Market` → `Shopping`; `Onsen/Ryokan` → `Spa/Wellness`; `Free/Buffer` → `Open Access`. Canonical type names pass through unchanged.

**Defaults** set on every parsed row: activities `status: 'Proposed'`, `cost: 0`; lodging `status` = `Booked` when `Booked?` is `Yes`, else `Proposed`; `rooms: 1`; `costPerNight = totalCost / nights` (derived from dates, never from `Days`). A `Days` value that differs from the computed nights only warns.

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

Duplicate suggestion on open: a row whose key exactly matches an existing record defaults to `skip` with `existingId` and `expectedFingerprint` set. Keys are `name|date|startTime|startLocation` (activities) and `name|checkInDate|checkOutDate|address` (lodging); matches are consumed one-to-one so legitimate repeat rows survive.

### 5.5 Commit request

`POST /api/activities/import` and `POST /api/lodgings/import`, JSON body ≤ **256 KiB**, authenticated.

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

**Server-side validation** (violations collected per row, returned together):

| Rule | Activities | Lodging |
|---|---|---|
| Required | `name`; `date` optional but must be valid ISO if present | `name`, `checkInDate`, `checkOutDate`; check-out strictly after check-in |
| Numbers | `cost` finite ≥ 0 | `totalCost`, `costPerNight` finite ≥ 0 |
| `update` | needs `existingId`; record must belong to `tripId` | same |
| `create` | must not carry `existingId` | same |
| Fingerprint | `name,date,startTime,startLocation,notes` | `name,checkInDate,checkOutDate,address,notes` |

Fingerprint = `JSON.stringify` of the listed fields, each `String(v ?? '').trim().toLowerCase()`. A mismatch means the record changed since review.

Writes: `status` is normalised (default `Proposed`); `activityType` defaults to `Other`; `travelerIds` default to all trip group members (lodging: to `paidBy` if given, else all members); lodging `rooms` is at least 1; lodging `imageUrl` is `null`. Each row also upserts its expense mirror (`sourceType` `activity` or `lodging`; an activity with no date deletes its mirror).

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
- `server/config/api-limits.yaml` → `DATA_TRANSFER_API`: 24 h window, overall 20,000; callers `ACTIVITY_IMPORT_ROWS` 15,000 and `LODGING_IMPORT_ROWS` 5,000.
- Logging is structured `[data-transfer] entity=… result=… rows=… durationMs=…`; CSV contents, notes and addresses are never logged.

---

## 6. Format D — Activities / Lodging CSV export

Client-only: `CsvTransferControls.exportCsv` builds the file from the rows already loaded in the tab, then `shareCsvFile` (web download via Blob; native share sheet via `expo-file-system` `File` + `expo-sharing`).

### 6.1 Columns

**Activities** (`activities-YYYY-MM-DD.csv`)

| # | Header | Source field |
|---|---|---|
| 1 | `WanderBunnies Record ID` | `id` |
| 2 | `WanderBunnies Record Fingerprint` | fingerprint of `name,date,startTime,startLocation,notes` |
| 3 | `Date` | `date` |
| 4 | `Activity Type` | `activityType` |
| 5 | `Start Time` | `startTime` |
| 6 | `Duration` | `duration` |
| 7 | `Activity Name` | `name` |
| 8 | `Activity Notes` | `notes` |
| 9 | `Activity Start Address` | `startLocation` |
| 10 | `Status` | `status` |
| 11 | `Cost` | `cost` |

**Lodging** (`lodgings-YYYY-MM-DD.csv`)

| # | Header | Source field |
|---|---|---|
| 1 | `WanderBunnies Record ID` | `id` |
| 2 | `WanderBunnies Record Fingerprint` | fingerprint of `name,checkInDate,checkOutDate,address,notes` |
| 3 | `Check In` | `checkInDate` |
| 4 | `Check Out` | `checkOutDate` |
| 5 | `Hotel` | `name` |
| 6 | `Booked?` | booked indicator |
| 7 | `Cancel By` | `refundBy` |
| 8 | `Cost` | `totalCost` |
| 9 | `Address` | `address` |
| 10 | `Notes` | `notes` |
| 11 | `Features` | `features` |
| 12 | `Rooms` | `rooms` |

The `Booked?` and `Features` cell serialisations are built in a long line in `CsvTransferControls.tsx` (`exportCsv`); confirm against that line before relying on them.

### 6.2 Serialization

`toCsv(headers, rows)` in `app/utils/dataTransfer.ts`:

- UTF-8 with a leading BOM (`﻿`), CRLF line endings, trailing CRLF.
- Cells containing `"`, `,`, CR or LF are quoted; `"` is doubled.
- **Formula-injection guard:** a text cell whose first non-whitespace character is `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`. Import does not strip this prefix.
- Not exported: payer/traveler assignments (internal IDs), image URLs, votes, ratings, owner IDs.

---

## 7. Feature flags, tiers and configuration

| Key | Where | Default | Controls |
|---|---|---|---|
| `itinerary_document_import` | `feature-flags.yaml` + tier entitlement | flag enabled; free ✗, premium ✓, pro ✓ | Format B |
| `activity_lodging_csv_import` | `feature-flags.yaml` | enabled | Format C (checked server-side via `assertCanUseFeature`) |
| `activity_lodging_csv_export` | `feature-flags.yaml` | enabled | Format D, together with master `csv_export` |
| `csv_export` | `feature-flags.yaml` | enabled | Master export switch |
| `DATA_TRANSFER_API` | `api-limits.yaml` | see §5.7 | Row metering for Format C |

Feature flags have no admin bypass; tier limits and entitlements do. Entitlement checks fail open on a missing row (see CLAUDE.md).

---

## 8. Related stored fields

| Field | Defined | Notes |
|---|---|---|
| `Trip.notes?: string \| null` | `server/src/types.ts` | Written by `PATCH /api/trips/:id` (`notes` alongside `description`) and by Format B appends. Surfaced as "Notes" on Overview. |
| `Lodging.notes?: string \| null`, `Lodging.features: string[]` | `server/src/types.ts` | Added so CSV import loses no lodging context. Postgres: `features JSONB NOT NULL DEFAULT '[]'`. |
| `ActivityType` includes `Other` | `server/src/types.ts` | Safe fallback for unknown types. |
| Item coordinates + source | adapter fn `setItemCoordinates` | Postgres/memory and Firestore; used by Format B. |
| `data_transfer_imports` | migration `20260822_add_data_transfer_imports.sql` | Idempotency receipts (Format C). |

---

## 9. Known gaps and plan-vs-code drift

Checked against the code on 2026-10-26. Items marked **Decision** need an owner to choose which side moves.

1. **Decision — CSV status for unbooked rows.** The architecture doc says blank/`No` in `Booked?` maps to `Needed`. The code maps it to `Proposed` (and activities default to `Proposed`, where the doc says `Needed`).
2. **Decision — canonical re-import by Record ID.** The architecture doc says `WanderBunnies Record ID` / `Record Fingerprint` columns drive same-trip update matching. The export writes them, but the import header alias tables do not include them, so on re-import they surface as *Ignored columns*, and duplicates are matched by name/date key instead. Likewise exported `Status`, `Cost` (activities), `Notes`, `Features`, `Rooms` (lodging) have no import alias, so a canonical export does not currently round-trip those fields.
3. **Activities `Cost` is not imported.** Import hard-codes `cost: 0` for activities; only lodging reads a cost column.
4. **Atomicity.** The doc promises all-or-nothing commits in one DB transaction. The route validates all rows first (so validation failures write nothing), but then saves rows one at a time; an infrastructure failure part-way through can leave earlier rows written with no receipt.
5. **Idempotency claim.** The doc describes a durable in-progress claim with lease. The route checks for an existing receipt and writes it after success, so two simultaneous requests with the same `importId` can both pass the check.
6. **Quota ordering.** Usage units are reserved after validation but before writes, as designed; there is no refund if the later writes fail.
7. **Format B jobs are in-memory.** A restart or a second Cloud Run instance loses or cannot see the job (single-instance only).
8. **Printout is lossy for notes.** Detail note bodies are not printed, so they cannot be imported.
9. **Single currency.** No format carries per-item currency; Format B only warns on a cover-currency mismatch.
10. **Export is not versioned.** Neither the HTML printout nor the CSV carries a schema version. If either layout changes, the parsers must be updated in step; adding a version marker is the recommended first step.

---

## 10. Where to change things

| Change | Touch |
|---|---|
| New field on the printout | `printableItinerary.ts` render fn + `*_LABELS` and field mapping in `wanderBunniesPrintParser.ts` (labels are order-sensitive) + candidate type + tests in `wanderBunniesPrintImport.test.ts`, `printableItinerary.test.ts` |
| New CSV column | alias table + `to*ReviewRows` in `dataTransfer.ts`, the `allowed` set in `activityDtos.ts` / `lodgingDtos.ts`, the route's payload mapping, and export headers in `CsvTransferControls.tsx` |
| New importable entity | new route file mounted before the global JSON parser in `app.ts`, DTO with `.strict()`, adapter functions in `db.postgres.ts` **and** `db.firebase.ts`, an `api-limits.yaml` caller, a feature flag |
| New extractor candidate type | `ItineraryDocumentCandidateType`, system prompt, `findExistingTripItemMatches`, the write branch in `importItineraryDocument` |

Tests: `server/__tests__/itineraryDocumentImportService*.test.ts`, `document-import-async.test.ts`, `wanderBunniesPrintImport.test.ts`, `item-coordinates.test.ts`; `app/tests/csvExport.test.ts`, `printableItinerary.test.ts`, `itineraryDocumentImportVisibility.test.ts`.
