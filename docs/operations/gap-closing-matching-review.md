# Matching completeness and import review — 2026-10-21

The automatic matcher and individual/batch review now use one authorized matching context. No production flag or default is changed; release evidence remains governed by the existing import-quality gate.

## Matching

- Candidate dates use booking-local dates and the existing one-day trip margin. Month-only trips can suggest, never auto-add. Invalid or unresolved timezones stay in individual review.
- All date-eligible candidates are hydrated before deciding uniqueness. Displaying five suggestions does not discard the sixth candidate's evidence. Evidence-read failure suppresses automatic/batch assignment.
- Place evidence includes destination/location IDs, airport-table city lookup, and cities of existing lodgings, activities and rentals. Catalog/manual/airport coordinates can supply strong evidence; approximate provenance stays weak. Country/region-only matches and departure-only flights stay suggestions. A known city within an explicitly named country disambiguates legacy text that also names a state.
- Booking continuity requires provider plus normalized reference, compatible booking type and dates scoped to that trip. Bare references cannot establish continuity. Corrections are merged; updates/cancellations require individual review.
- Traveler names matching active group members rank suggestions, but never resolve multiple strong matches automatically. There are no LLM calls or external geocoding calls in matching.
- Forwarding trust is derived from the server-owned document and current receiver receipt/authentication policy. The review UI only claims verification when the server proves it; uncertain forwarding is labeled for inspection.

## Review and creation

`GET /api/ingestion/review-suggestions` previews at most 20 queued items. Each row includes the booking, target trip, reasons, dates, reported amount/currency, forwarding trust and a content version. No rows start selected. An item cursor (`?after=...`) allows moving past batches requiring individual review.

`POST /api/ingestion/review-suggestions/confirm` accepts 1–20 distinct `{ itemId, tripId, reviewVersion }` entries. It rechecks ownership, current trip permission, content version and current unique match for every entry. Each entry commits independently; HTTP 207 reports partial failures and leaves those bookings available for individual review. A same-trip retry recognizes already-assigned items without creating another booking or cost. Preview endpoints use private/no-store caching and per-user rate limits.

The shared assignment repository also rechecks item content/state and target write permission inside PostgreSQL/Firestore assignment transactions. Existing booking/expense/message atomicity and automatic Undo remain in place. No schema migration is needed for this continuation.

Individual review uses the same reasons and offers **Create a trip from this booking**. Quick Start starts with the booking's name, local date range and destination search text. The traveler must choose a real destination and create the trip. Success returns to the original import with the new trip selected; adding the booking remains explicit. Cancellation returns to Imports. Account changes fence old requests, selection and creation callbacks.

## Validation and bounds

Automated checks cover scoped continuity, corrected details, airport/city evidence, country-only and approximate geography, month-only dates, traveler ranking, more than five candidates, stale preview rejection, partial results, ownership, retry safety, and transactional stale-content rejection. UI checks cover selection, partial/network failures, pagination, account fencing, forwarding copy, wizard prefill and return-to-review confirmation. The provider-neutral integration suite runs against pg-mem and the Firestore emulator.

Real PostgreSQL contention, physical devices, assistive-technology trials and representative audited import precision remain release evidence. This implementation does not establish live receiver authentication or permit enabling automatic imports without those gates.


Validation results for this continuation: 81 backend tests across seven focused suites passed on pg-mem/mocked-adapter coverage; all 24 provider-neutral assignment/review integration tests passed on the Firestore emulator. Seven focused frontend suites passed 43 tests. App/server TypeScript checks, production web export and `git diff --check` passed. The full repository suite and real-browser/native-device acceptance were not run for this slice.
