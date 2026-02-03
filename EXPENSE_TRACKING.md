# Expense Tracking Behavior

This document describes how trip expenses are recorded, converted, and summarized in the Travel Itinerary App.

## Data Sources
- **Daily Expenses**: Manually entered in the Daily Expenses screen. Each expense requires:
  - `expenseDate`, `category`, `amount`, `currency`
  - At least one payer (`payerIds`) and one traveler used-for (`forIds`)
- **Flights / Lodging / Tours**: When these items are created or updated, the server writes (or upserts) a matching expense record to the `expenses` table for cost reporting.
- **Car Rentals**: Stored client-side and included in the Ledger by treating `paidBy` as the payer list. If no payers are selected, the cost is split across all active travelers.

All sources are consolidated into the **expenses** table to power the Cost Report and Ledger.

## Paid vs. Used
- **Paid**: Split an expense amount evenly across the `payerIds` list.
- **Used**: Split an expense amount evenly across the `forIds` list.
- Remainders from floating-point splits are applied to the first ID in each list to keep totals aligned.

The Ledger uses these split rules and sums across **all expense categories**, plus car rentals.

## Currency Conversion
- Each expense stores:
  - `amount` and `currency` (original values)
  - Optional `amountInTripCurrency`, `exchangeRateToTripCurrency`, `exchangeRateDate`
- When the expense currency differs from the trip currency, the client attempts to fetch **today’s local FX rate** and saves the converted amount.
- The Ledger falls back to on-demand FX conversion if a converted amount is missing.

## UI Behavior Summary
- **Daily Expenses**: User picks date, category, currency, amount, payers, and used-for travelers.
- **Cost Report**: Aggregates totals by category and traveler.
- **Ledger**: Shows Paid vs. Used totals per traveler with trip-currency formatting.
