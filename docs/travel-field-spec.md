# Travel Field Spec

Reference for the field-quality evaluator described in [`ai-capture-eval-plan.md`](./ai-capture-eval-plan.md) §5c. Defines, per parsed item type, which fields are expected, whether they're `required` (a parse without it is broken) or `typicallyPresent` (usually shows up in a good extraction but its absence isn't disqualifying), and what format standard (if any) backs the validation regex.

The machine-readable counterpart is `server/config/travel-field-spec.json`, loaded the same way `server/config/api-limits.yaml` is loaded. Keep the two in sync — this document explains *why* a rule exists; the JSON is what the code actually runs.

Item types match `ParsedItemType` in `server/src/ingestion/contracts/index.ts`: `flight`, `rail`, `ferry_bus_transfer`, `hotel`, `car_rental`, `tour_activity`. (`restaurant_reservation`, `event_ticket`, `generic_note` are intentionally out of scope for v1 — they have no standardized codes to validate against; revisit if parser volume for those types justifies it.)

---

## Standards referenced

| Standard | Governs | Format |
|---|---|---|
| IATA airport code | Airports (departure/arrival/layover) | 3 uppercase letters, e.g. `JFK` |
| IATA airline designator | Carriers | 2 characters — letters or letter+digit, e.g. `DL`, `B6`, `AA` |
| Flight number | Carrier + flight | Airline designator + 1–4 digits, e.g. `DL123` |
| PNR / booking reference (IATA Type A/B) | Airline & many rail/car bookings | 6 characters, alphanumeric. Airlines commonly avoid visually ambiguous characters (`0`/`O`, `1`/`I`) but this isn't a hard rule — validate as `[A-Z0-9]{6}`, not stricter |
| E-ticket number | Rarely user-facing in parsed confirmations | 13 digits (3-digit airline numeric code + 10-digit serial) — included for completeness, `typicallyPresent: false` since most confirmation emails don't surface it |
| ISO 8601 date | All date fields | `YYYY-MM-DD` |
| 24-hour time | All time fields | `HH:mm` |
| ISO 4217 currency code | Cost fields | 3 uppercase letters, e.g. `USD` |

Fields with **no universal standard** (hotel names, addresses, vendor-specific confirmation numbers) are intentionally *not* regex-validated — a wrong-shaped regex there produces false "invalid" flags more often than it catches real errors. Those fields use presence/blank-rate tracking only (§5d of the main plan), not format validation.

---

## Flight / Rail / Ferry-Bus Transfer

These three item types share the same field shape in `server/src/types.ts` (`Flight` interface, `transferType` discriminates Flight/Train/Bus/Private/Ferry/Other) and in ingestion (`ParsedItemType`: `flight`, `rail`, `ferry_bus_transfer`). One ruleset covers all three; airport-code validation is skipped for bus/private-transfer items where "airport code" doesn't apply (rail stations and bus stops have no IATA equivalent — those fall back to presence-only).

| Field | Required | Typically present | Format | Notes |
|---|---|---|---|---|
| `carrier` | Yes | — | Free text | Airline/rail/bus operator name. No format standard; presence-only. |
| `flightNumber` | Yes (flight only) | Yes | `^[A-Z0-9]{2}\d{1,4}$` | Airline designator + digits. N/A for bus/ferry; `typicallyPresent: false` for rail (train numbers vary widely, often not validated). |
| `bookingReference` | No | Yes | `^[A-Z0-9]{6}$` | PNR. This is the field your original "6-letter code" almost certainly meant — corrected to alphanumeric, not letters-only. |
| `departureAirportCode` / `arrivalAirportCode` / `layoverLocationCode` | Yes (flight only) | Yes | `^[A-Z]{3}$` | IATA. Skip for rail/bus/ferry — use `departureLocation`/`arrivalLocation` free text instead. |
| `departureDate` / `arrivalDate` | Yes | — | ISO 8601 date | |
| `departureTime` / `arrivalTime` | Yes | — | `HH:mm` (24h) | |
| `passengerName` | Yes | — | Free text | |
| `cost` | No | Yes | Numeric, non-negative | Currency handled via trip-level currency, not per-item in current schema. |

## Lodging (Hotel)

Maps to `Lodging` in `server/src/types.ts` and `hotel` in `ParsedItemType`.

| Field | Required | Typically present | Format | Notes |
|---|---|---|---|---|
| `name` | Yes | — | Free text | No standard; presence-only. |
| `check_in_date` / `check_out_date` | Yes | — | ISO 8601 date | `check_out_date` must be after `check_in_date` — a cross-field plausibility check, not a per-field regex. |
| `confirmationNumber` | No | Yes | `^[A-Z0-9]{5,12}$` | Vendor-specific length/format, no universal standard — this range is a loose plausibility band (rejects obviously-wrong extractions like a full sentence), not a real format spec. Treat low-confidence, don't hard-fail on it. |
| `address` | No | Yes | Free text | Presence-only. |
| `rooms` | No | Yes | Positive integer | |
| `total_cost` / `cost_per_night` | No | Yes | Numeric, non-negative | |

## Car Rental

Maps to `CarRental` in `server/src/types.ts` and `car_rental` in `ParsedItemType`.

| Field | Required | Typically present | Format | Notes |
|---|---|---|---|---|
| `vendor` | Yes | — | Free text | |
| `pickupLocation` / `dropoffLocation` | Yes | — | Free text | Often an airport code embedded in a location string (e.g. "LAX - Airport") — do not force airport-code regex on the whole field; a `containsAirportCode: boolean` soft signal is more useful than a hard validator here. |
| `pickupDate` / `dropoffDate` | Yes | — | ISO 8601 date | dropoff must be ≥ pickup. |
| `reference` | No | Yes | `^[A-Z0-9]{5,10}$` | Same caveat as lodging `confirmationNumber` — vendor-specific, loose plausibility band only. |
| `model` | No | Yes | Free text | Often a class ("Economy", "SUV") rather than a literal model — presence-only. |
| `cost` | No | Yes | Numeric, non-negative | |

## Activity / Tour

Maps to `Activity` in `server/src/types.ts` and `tour_activity` in `ParsedItemType`.

| Field | Required | Typically present | Format | Notes |
|---|---|---|---|---|
| `name` | Yes | — | Free text | |
| `date` | Yes | — | ISO 8601 date | |
| `startTime` | No | Yes | `HH:mm` (24h) | Many activity confirmations omit exact time. |
| `startLocation` | No | Yes | Free text | |
| `reference` | No | Yes | `^[A-Z0-9]{5,10}$` | Same loose plausibility band as lodging/car-rental — booking platforms (Viator, GetYourGuide, direct vendor) don't share a format standard. |
| `duration` | No | Yes | Free text (e.g. "2 hours") | No standard; presence-only. |
| `cost` | No | Yes | Numeric, non-negative | |

---

## Using this spec

- **Format-valid rate** (plan §5c): for fields with a `format` regex, `formatValid = pattern.test(value)` when present. Fields without a format (marked "Free text" / "presence-only") never fail format validation — they only contribute to the blank-rate metric below.
- **Blank-field rate** (plan §5d): `blankRate = countMissing(typicallyPresent fields) / countTotal(typicallyPresent fields)`, computed per intake and rolled up over time per item type per field. `required` fields missing entirely should be treated as a parser failure, not just a blank-rate contributor — surface those separately (e.g. "extraction produced zero required fields" is a different alert than "extraction is missing a typically-present field").
- **Plausibility bands are not correctness checks.** Several fields above (confirmation numbers, vendor references) have no real external standard — their regex is a loose sanity filter, not ground truth. Don't let a "format valid" pass on these fields be read as "content is correct"; that's what the AI-vs-production-parser comparison (plan §5e) is for.

## Maintenance

When adding a new field to `Flight`/`Lodging`/`Activity`/`CarRental` in `server/src/types.ts`, add a corresponding row here and in `travel-field-spec.json` in the same PR — the evaluator silently skips fields it has no rule for (fail-open, consistent with the rest of this codebase's config philosophy), so a missing entry doesn't break anything but does mean that field gets no quality tracking until added.
