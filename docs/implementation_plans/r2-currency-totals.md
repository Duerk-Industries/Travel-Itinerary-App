# R2: consistent trip-currency totals

## Discovery and agreed scope

- `app/tabs/dailyExpenses.tsx` sums raw amounts and hard-codes dollar labels.
- `app/utils/costs.ts` builds Settle Up/Cost Report expenses using stored converted
  amounts but falls back to raw foreign amounts when a conversion is absent.
- `app/App.tsx` independently applies the same raw fallback for category totals.
  `app/tabs/tripBlog.tsx` receives unified expenses and sums those for Trip spend.
- `server/src/types.ts` and both DB adapters already store trip currency and
  expense rate/converted-amount fields. The quote's target currency is not stored.
- `server/src/routes/expenseRoutes.ts` currently accepts client conversion fields.
- `server/src/routes/tripRoutes.ts` defaults new trips to USD; Overview already
  offers a trip currency selector. Bookings lack a common stored currency field.
- `packages/domain/src` is the existing location for shared pure business rules.

The user chose server-validated, persisted conversions while preserving the
existing client splitting/covering logic. Older expenses and home-currency changes
use historical rates where available; unresolved conversions are visible and
never silently treated as 1:1.

Implement one conversion/formatting helper in the domain package, explicit quote
target metadata in both adapters, destination-based defaults, per-traveler/trip
last-used expense currency, and consistent original/converted amount displays.
Preserve existing nonempty trip currency selections and existing covering rules.
