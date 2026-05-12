# Merchant Category Lookup API Guardrails

**Status:** Planning complete. Applies to proposed `merchantCategoryLookupService.ts`.
**Last updated:** 2026-05-12

## Purpose

Use an optional external lookup to suggest a Daily Expense category from a parsed receipt vendor.

The lookup is advisory only. It must never block manual expense entry or saving an expense.

## Proposed Provider

Use OpenStreetMap Nominatim public search API as the first free provider.

Why:

- It is free for light use.
- Search results can include place `category`/`type` values that can be mapped to existing expense categories.
- It does not require sending receipt images or full receipt text.

Official references:

- Nominatim Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
- Nominatim Search API docs: https://nominatim.org/release-docs/latest/api/Search/
- OpenStreetMap attribution guide: https://www.openstreetmap.org/copyright/attribution-guide/

## Required Guardrails

### Server-Side Only

Do not call the provider directly from the mobile app.

All calls go through:

`server/src/services/merchantCategoryLookupService.ts`

Reasons:

- Centralized rate limiting.
- No client-side provider coupling.
- Better privacy controls.
- Easier provider replacement.

### Feature Flag

Default off until tested via database feature flag:

`merchant_category_lookup` (default: `false` via `server/config/feature-flags.yaml`)

When disabled, return `null` and let receipt parsing default category normally.

### Rate Limit

The public Nominatim usage policy allows light use and states an absolute maximum of 1 request per second.

Implement a server-wide limiter:

- 1 request/second maximum.
- Queue length cap, e.g. 20.
- If queue is full, skip lookup.
- No client retry storm.

### Timeout

Use a short timeout:

- 1,500 ms default.
- On timeout, return `null`.
- Do not retry synchronously in the user request.

### Cache

Cache by normalized key:

`vendor + city/destination + country`

Suggested TTL:

- 30 days for successful category results.
- 1 day for no-match results.
- 10 minutes for provider errors.

Cache should store only:

- normalized query
- mapped category
- provider result type/category
- confidence
- timestamp

Do not store raw receipt text.

### User-Agent And Attribution

Set a specific User-Agent identifying the app and contact/admin URL or email if configured.

Example:

`WanderBunniesTravel/1.0 (merchant-category-lookup; contact configured by MERCHANT_LOOKUP_CONTACT)`

If Nominatim-derived suggestions are shown in UI, include OpenStreetMap attribution in an appropriate app/about or details surface.

### Privacy

Only send:

- vendor name
- optional city/destination context
- optional country/region context

Never send:

- receipt image
- full OCR text
- traveler names
- payment card details
- exact expense amount
- user id
- trip id

### Logging

Allowed logs:

- provider name
- success/failure
- duration bucket
- cache hit/miss
- mapped category
- non-PII error class

Do not log:

- raw provider response
- raw receipt OCR
- full vendor query if it may include personal data

### Failure Behavior

All failures return `null`:

- Disabled provider
- Timeout
- 429/rate limited
- 5xx
- malformed response
- no confident mapping

The receipt flow should continue with:

- parsed vendor if available
- default category `Other`
- user-editable fields

### Mapping Confidence

Return shape:

```ts
type MerchantCategorySuggestion = {
  category: 'Breakfast' | 'Lunch' | 'Dinner' | 'Other Food' | 'Rides' | 'Souvenirs' | 'Other';
  confidence: number;
  provider: 'nominatim';
  providerCategory?: string | null;
  providerType?: string | null;
};
```

Suggested confidence:

- 0.85 for direct known mappings, e.g. `amenity=cafe`.
- 0.65 for broad shop/amenity mappings.
- Below 0.6 should return `null` and let caller default to `Other`.

### Replacement Path

Keep provider code behind an interface:

```ts
type MerchantCategoryProvider = {
  lookup(input: MerchantCategoryLookupInput): Promise<MerchantCategorySuggestion | null>;
};
```

This lets the app later switch to:

- self-hosted Nominatim
- paid Places API
- MCC database
- internal vendor-category cache

without changing receipt parsing or expense creation code.

## Test Requirements

- Provider disabled returns `null`.
- Rate limiter prevents more than one provider call per second.
- Timeout returns `null`.
- 429 returns `null` and writes short error cache.
- Successful lookup is cached.
- No-match lookup is cached.
- Mapping tests cover cafe, restaurant, rides/fuel, souvenir, and unknown.
- Tests assert request body/query excludes receipt text, amount, user id, and trip id.

