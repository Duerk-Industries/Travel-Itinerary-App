# Accounting Fixes

## Summary
The Cost Report and Ledger were drifting because we were **double-counting source-backed expenses** and the Cost Report’s **Overall** row was showing **balances (paid minus used)** instead of **paid totals**. That created mismatches with the Ledger and negative values in the Cost Report.

## Root Causes
1. **Double counting**  
   The client was building totals from:
   - Flights/Lodgings/Tours/Car Rentals, **and**
   - Expenses returned by the API (which already include **sourceType** entries for those same items)

   This duplicated totals (e.g., flights $2084 showing as $4168 in the Cost Report).

2. **Overall row semantics**  
   The Cost Report’s Overall row was displaying **balances** (paid minus used), which can be negative.  
   Users expected it to show **paid totals**, matching the Ledger’s “Paid” column.

3. **Field mismatch and missing attendee usage**  
   `buildAllExpenses` was mixing snake/camel case field names and, for Tours, used `paidBy` for “used” totals even when attendee/traveler IDs were available.

## Fixes
1. **Filtered out source-backed expenses**  
   Only “manual” expenses are included in the unified totals.  
   Source expenses (with `sourceType`) are excluded to prevent double counting.

2. **Normalized all item fields in `buildAllExpenses`**  
   - Supports camelCase and snake_case.
   - Uses `passengerIds` for flights, `travelerIds` for lodgings/tours/rentals when available.
   - Correctly falls back to `allMemberIds` only when needed.

3. **Cost Report Overall row uses paid totals**  
   The Overall row now uses `ledgerPaidTotals` so it aligns with the Ledger Paid column and never shows negative values there.

4. **Tests**
   - Added **client test** to ensure source expenses don’t double-count totals.
   - Added **server test** to verify a single source expense row is updated when paidBy changes.

## Files Changed
- `app/utils/costs.ts`  
  Normalized field usage and filtered out `sourceType` expenses.
- `app/App.tsx`  
  Overall row now uses paid totals.
- `app/tests/costsConsistency.test.ts`  
  Verifies no double-counting and correct tour attendee usage.
- `server/__tests__/expense-sync.test.ts`  
  Verifies expense updates stay singular when paidBy changes.

## Outcome
Totals now match across:
1. Individual pages (Flights/Lodging/Tours/Car Rentals)
2. Ledger (Paid/Used)
3. Cost Report (by category + Overall row)

Paid totals in the Ledger now match the Overall row for each traveler in the Cost Report, and category totals match the item totals shown in their respective pages.

## Expense Covering (Per Trip)
Expense covering now lives on the **Ledger** page and is **scoped to the active Trip** (not the group).

### Behavior Without Covering
- All travelers appear in the Ledger and Cost Report.
- Paid and Used totals reflect the traveler’s own expenses.

### Behavior With Covering
- A covered traveler does **not** appear in the Ledger or Cost Report.
- Any **paid** or **incurred** amounts for the covered traveler roll up to the covering traveler.
- A traveler may only be covered by one other traveler.
- If a traveler covers anyone, they cannot be covered by someone else (no chains).

### Implementation Notes
- Covering rules are saved to the **Trip** via `PUT /api/trips/:tripId/covered-by`.
- The Ledger and Cost Report use roll-ups so covered travelers are removed and their totals aggregate into the covering traveler.
