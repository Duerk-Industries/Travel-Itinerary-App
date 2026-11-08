# Tiers

[README](../README.md) · [Manual administration](operations/manual-administration.md) · [Feature flags](feature-flags.md) · [Rollout testing](operations/rollout-testing.md)

## Overview

Tiers are entitlement controls, not deployment toggles. Runtime truth lives in the database, and new users normally receive `free` on signup/login (explicit seeded-email exceptions and bootstrap admins are handled by `entitlementService.ts`). The backend is the source of truth for all feature and limit checks.

## Seeded tier definitions

These are code defaults, not a report of the live database. Verify Admin → Tiers before testing a numeric cap. Selected entitlement defaults are upserted by `seedEntitlementDefaults()` at startup; manual edits to those rows may be reset.

| Tier | Key | Rank | Max active trips | Max travelers/trip | AI generations/month | Notes |
|---|---|---:|---:|---:|---:|---|
| Free | `free` | 1 | 3 | 6 | 5 | Can share trips and follow trips |
| Premium | `premium` | 2 | 250 | 200 | unlimited | Includes receipt scanning |
| Pro | `pro` | 3 | 250 | 200 | unlimited | Inherits Premium and Free |

`rank` defines inheritance. Higher tiers inherit lower-tier capabilities unless they override them explicitly.

## Active trip rules

- An active trip uses `endDate >= CURRENT_DATE` (Postgres date comparison) inclusive.
- `endDate = null` counts as active.
- Trips the user follows do not count toward active-trip limits.
- Trips the user owns or has accepted as a group member do count.
- Non-admin users cannot create or update trips with `endDate < nowUtc`.

## Entitlement defaults

| Feature | Free | Premium | Pro |
|---|---|---|---|
| `trip_creation` | allowed | inherited | inherited |
| `trip_sharing` | allowed | inherited | inherited |
| `trip_following` | allowed | inherited | inherited |
| `ai_itinerary_generation` | allowed | inherited | inherited |
| `car_rentals` | allowed | inherited | inherited |
| `csv_export` | allowed | inherited | inherited |
| `cost_tracking` | allowed | allowed | allowed |
| `receipt_scanning` | denied | allowed | allowed |

## Ingestion quotas

| Capability | Free | Premium | Pro |
|---|---:|---:|---:|
| manual uploads / month | 0 | 50 | 500 |
| Gmail lookback window | 0 days | 30 days | 90 days |
| LLM escalation | none | small only | large allowed |

These are the default Premium-only settings. Admin → Billing → Premium parsing can open individual parsing options to Free accounts; the `premium` master switch and the option's own feature flag still apply. Free accounts admitted through that policy use Premium monthly allowances. See [Premium and parsing options](feature-flags.md#premium-and-parsing-options).

## Gate functions

All API and UI flows should rely on the same backend contract:

- `assertCanUseFeature(userId, featureKey, role)` (throws on denial) and `canUseFeature(userId, featureKey, role)`
- `assertUnderActiveTripLimit`, `assertUnderTravelerLimit`, `assertAndIncrementGenerationCount`
- `getEffectiveLimit(userId, limitKey)`
- `getLimit(userId, limitKey)`
- `recordUsage(userId, usageKey, amount, metadata)`

`getLimit(...)` resolves values by walking the user's tier rank downward until it finds an explicit row. `-1` means unlimited; `null` means no configured limit (fail-open). Feature flags are checked before tier entitlements, with no admin flag bypass.

`recordUsage(...)` writes both counters and append-only usage events. Rolling reporting uses usage events; monthly quota enforcement uses UTC month keys plus idempotency-aware reservations.

## Admin behavior

Admins bypass:

- numeric limits and tier entitlements
- past-trip-date restrictions

Admins do not bypass:

- feature flags
- authentication
- admin RBAC checks

## AI itinerary counting

- Count window: UTC calendar month.
- Only successful generations count.
- Duplicate requests must reuse an idempotency key and must not double-charge usage.
- Enforcement occurs server-side before and after generation finalization.
