# Tiers

## Overview

Tiers are entitlement controls, not deployment toggles. Runtime truth lives in the database, and every new user is assigned `free` on first signup/login. The backend is the source of truth for all feature and limit checks.

## Tier definitions

| Tier | Key | Rank | Max active trips | Max travelers/trip | AI generations/month | Notes |
|---|---|---:|---:|---:|---:|---|
| Free | `free` | 1 | 3 | 6 | 5 | Can share trips and follow trips |
| Premium | `premium` | 2 | 250 | 200 | unlimited | Includes cost tracking |
| Pro | `pro` | 3 | 250 | 200 | unlimited | Inherits Premium and Free |

`rank` defines inheritance. Higher tiers inherit lower-tier capabilities unless they override them explicitly.

## Active trip rules

- An active trip uses `endDate >= nowUtc` inclusive.
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
| `cost_tracking` | denied | allowed | allowed |

## Gate functions

All API and UI flows should rely on the same backend contract:

- `canUseFeature(userId, featureKey)`
- `getLimit(userId, limitKey)`
- `recordUsage(userId, usageKey, amount, metadata)`

`getLimit(...)` resolves values by walking the user's tier rank downward until it finds an explicit row. `-1` means unlimited.

`recordUsage(...)` writes both counters and append-only usage events. Rolling reporting uses usage events; monthly quota enforcement uses UTC month keys plus idempotency-aware reservations.

## Admin behavior

Admins bypass:

- numeric limits
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
