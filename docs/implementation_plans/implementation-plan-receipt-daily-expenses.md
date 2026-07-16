# Receipt Photo Daily Expenses - Implementation Plan

**Status:** Planning complete. Ready for implementation.
**Last updated:** 2026-05-12

## Goal

Let a traveler add a daily expense from a phone photo of a receipt:

1. Take or choose a receipt picture on mobile.
2. Parse date, amount, currency, vendor, notes, and likely category.
3. Open the existing Daily Expenses add/edit flow with parsed values prefilled.
4. Let the user review and modify everything before saving.

The saved expense should show `category`, `vendor`, and `notes` in the expense details view.

## Current State

- `app/tabs/dailyExpenses.tsx` supports manual expense creation with date, category, currency, amount, payers, and travelers.
- Server `createExpenseDto` already accepts `notes`, but the app `Expense` type and detail UI do not show it yet.
- `category` already exists as a core field.
- `vendor` is not yet present end-to-end and needs schema, DTO, adapter, API, app state, and UI work.
- Receipt ingestion exists elsewhere in the app, but daily expenses currently have no photo capture or OCR flow.

## Proposed UX

### Add Expense Entry Points

- Keep `+ Add Expense`.
- Add a secondary action on phones: `Scan Receipt`.
- On web/desktop, show `Upload Receipt` if file input support is straightforward; otherwise keep the scan action mobile-only for phase one.

### Mobile Photo Flow

1. User taps `Scan Receipt`.
2. App opens camera or image picker.
3. User takes/selects a photo.
4. App uploads the image to a new receipt-parse endpoint.
5. UI shows a parsing state.
6. Parsed values open in the Daily Expense modal:
   - Date
   - Category
   - Vendor
   - Amount
   - Currency
   - Notes
   - Payers
   - Travelers
7. User edits values and taps `Save Expense`.

Important: saving remains explicit. Never auto-save a parsed receipt.

## Data Model Changes

### Expense Fields

Add or confirm these fields across app/server/db:

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `category` | string | yes | Already exists. Continue validating against allowed categories. |
| `vendor` | string/null | no | Merchant name from OCR or user input. |
| `notes` | string/null | no | User notes plus optional receipt parse summary. |
| `receiptImageId` | string/null | no | Optional future link to stored image. Not needed for first implementation if we avoid storing images. |
| `receiptParseConfidence` | number/null | no | Optional confidence for diagnostics. |

### Database

Postgres:

- Add migration for `expenses.vendor TEXT`.
- Confirm `expenses.notes TEXT` exists; add migration if missing.
- Optional later: `receipt_image_id TEXT`, `receipt_parse_confidence NUMERIC`.

Firebase:

- Include `vendor` and `notes` on expense writes/reads.

## API Changes

### Expense CRUD

Update:

- `server/src/routes/expenseDtos.ts`
- `server/src/routes/expenseRoutes.ts`
- Postgres/Firebase `insertExpense` and `listExpenses`

DTO behavior:

- `vendor`: trim, store `null` when blank.
- `notes`: trim, store `null` when blank.
- Reject overly long values:
  - `vendor`: max 160 chars
  - `notes`: max 2,000 chars

### Receipt Parse Endpoint

Add:

`POST /api/expenses/receipt/parse`

Request:

- `multipart/form-data`
- `tripId`
- `image`

Response:

```json
{
  "expenseDate": "2026-05-22",
  "amount": 42.18,
  "currency": "USD",
  "vendor": "Blue Bottle Coffee",
  "category": "Breakfast",
  "notes": "Parsed from receipt photo. Review before saving.",
  "confidence": 0.82,
  "rawSignals": {
    "merchantCategorySource": "nominatim",
    "merchantCategory": "cafe"
  }
}
```

The endpoint must require auth, `cost_tracking` entitlement, and trip membership.

## Receipt Parsing Design

### Phase 1 - Practical Parser

Use server-side image OCR:

- Reuse existing OCR utility if possible: `server/src/ingestion/normalization/ocr`.
- Otherwise introduce a narrow `receiptOcrService.ts`.
- Extract text from image.
- Parse with deterministic heuristics first:
  - Date patterns
  - Total/amount patterns near `total`, `amount`, `visa`, `mastercard`
  - Currency symbol or trip currency fallback
  - Vendor from top non-empty lines
- Use category lookup only after a likely vendor is found.

### Phase 2 - Better Parser

Optionally add an LLM-assisted parser behind an existing AI feature flag and budget guard, but do not require it for the first version.

## Merchant Category Lookup

Put merchant categorization in a separate service file:

- `server/src/services/merchantCategoryLookupService.ts`

Recommended free first provider:

- OpenStreetMap Nominatim public search API.
- Query vendor plus optional trip destination/city.
- Use returned `category`, `type`, `class`, and `display_name` to map to app categories.

Example mapping:

| OSM category/type | App category |
|---|---|
| `amenity=restaurant`, `amenity=fast_food` | Dinner or Other Food |
| `amenity=cafe`, `shop=bakery` | Breakfast or Other Food |
| `amenity=bar`, `amenity=pub` | Other Food |
| `shop=convenience`, `shop=supermarket` | Other Food |
| `amenity=fuel`, `highway=services` | Rides |
| `shop=gift`, `shop=souvenir` | Souvenirs |

If the mapping is low confidence, default to `Other`.

Provider guardrails belong in a separate document:

- [Merchant Category Lookup API Guardrails](./merchant-category-lookup-guardrails.md)

## App UI Changes

### Add Expense Modal

Add fields:

- `Vendor`
- `Notes`

Keep current fields:

- Date
- Category
- Currency
- Amount
- For
- Payers

When launched from a parsed receipt, prefill fields but keep them editable.

### Expense Details Modal

Current details table shows:

- For
- Payers
- Amount
- Action

Add visible detail fields per expense:

- Category
- Vendor
- Notes
- Currency if different from trip currency
- Amount in trip currency if present

Keep delete behavior unchanged.

## Error Handling

- If camera permission is denied, show a clear message and allow manual entry.
- If OCR fails, open manual Add Expense with an optional note: `Receipt could not be parsed.`
- If merchant category lookup fails, still show parsed vendor/amount/date and default category to `Other`.
- If upload fails, keep the user in the flow and allow retry or manual entry.

## Privacy And Storage

Phase one should avoid storing receipt images unless needed for debugging or future audit features.

- Process image server-side.
- Delete temporary upload after parsing.
- Do not log OCR text or full receipt contents.
- Log only non-sensitive metadata: parse success/failure, provider, duration, confidence bucket.

## Phased Implementation

### Phase 0 - Data Model And Detail UI

- Add `vendor` and confirm/add `notes`.
- Update server DTOs and DB adapters.
- Update app `Expense` type.
- Update Daily Expense modal and details modal.
- Add tests.

### Phase 1 - Receipt Parse Endpoint

- Add multipart endpoint.
- Wire OCR and deterministic parser.
- Return parsed draft, not a saved expense.
- Add endpoint tests with fixture images.

### Phase 2 - Mobile Capture UI

- Add camera/image picker dependency suitable for Expo.
- Add `Scan Receipt` action.
- Upload selected image and prefill add modal.
- Add mobile/responsive tests where possible.

### Phase 3 - Merchant Category Lookup

- Add `merchantCategoryLookupService.ts`.
- Add Nominatim adapter behind env flag and rate limit.
- Add cache and provider tests.
- Wire parsed vendor to lookup result.

### Phase 4 - Polish

- Confidence labels: `Suggested`, `Needs review`.
- Show parsed fields with subtle “from receipt” treatment.
- Add optional receipt image storage only if a product need emerges.

## Robust Test Plan

### Unit Tests

- `expenseDtos.test.ts`
  - Accepts `vendor` and `notes`.
  - Trims blank `vendor`/`notes` to `null`.
  - Rejects overlong `vendor`/`notes`.
- `receiptParser.test.ts`
  - Parses total amount from common receipt layouts.
  - Avoids subtotal/tax when a total exists.
  - Falls back safely when no amount is found.
  - Parses dates in common US formats.
  - Extracts likely vendor from top receipt lines.
- `merchantCategoryLookupService.test.ts`
  - Maps OSM `amenity=cafe` to app food category.
  - Maps `shop=souvenir` to `Souvenirs`.
  - Defaults to `Other` for unknown/low-confidence result.
  - Respects disabled provider flag.
  - Uses cached result before calling provider.
  - Handles timeout/429/network failure without throwing to user flow.

### Server Integration Tests

- `expenses.test.ts`
  - POST expense persists `vendor` and `notes`.
  - GET expense returns `vendor` and `notes`.
  - Existing category validation still rejects invalid categories.
- `receiptExpenseRoutes.test.ts`
  - Rejects unauthenticated receipt parse.
  - Rejects user outside trip.
  - Rejects unsupported image/mime type.
  - Rejects oversized file.
  - Returns parsed draft for valid image fixture.
  - Does not create an expense row during parse.
  - Cleans up temp file after parse.

### App Tests

- `dailyExpenses.test.tsx`
  - Add modal shows `Vendor` and `Notes`.
  - Saving sends `vendor` and `notes`.
  - Detail modal shows category/vendor/notes for an added expense.
  - Existing delete behavior still works.
- `dailyExpensesResponsive.test.tsx`
  - Mobile card flow can open detail modal and see vendor/notes.
  - Desktop table flow can open detail modal and see vendor/notes.
- Receipt scan UI tests:
  - Scan button visible on phone layout.
  - Permission denied shows fallback/manual-entry path.
  - Successful parse pre-fills date/category/vendor/amount/currency/notes.
  - User edits parsed fields before save and edited values are posted.

### E2E Tests

- Extend `app/e2e/keyboard-expense-flow.test.ts`:
  - Manual flow still keyboard-accessible after new fields.
- Add receipt-flow E2E where feasible:
  - Mock receipt parse endpoint.
  - Click `Scan Receipt`/upload fixture.
  - Verify prefilled modal.
  - Edit vendor/category/notes.
  - Save.
  - Open details and verify persisted values.

### Non-Functional Tests

- API guardrail tests:
  - Nominatim calls never exceed configured rate.
  - Missing provider config disables lookup.
  - Provider timeout does not block save.
  - No receipt OCR text appears in logs.
- Accessibility:
  - Camera/upload button has descriptive label.
  - Parsed-field confidence/error messages use accessible text.
  - Notes input has label and multiline behavior.

## Open Questions

- Should receipt photos ever be retained, or should phase one always delete them after parsing?
- Should category options expand beyond the current list?
- Should `vendor` be searchable/filterable later in the Daily Expenses grid?
- Should parse confidence be shown to users or only used internally?

