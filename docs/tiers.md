# Tiers

## Overview

The tier system controls per-user numeric limits (e.g. max active trips) and feature entitlements (e.g. AI itinerary generation access). Every user has an active tier; new users are automatically assigned the **free** tier.

## Tier definitions

| Tier | Key | Rank | Max active trips | Max travelers/trip | AI generations/month |
|---|---|---|---|---|---|
| Free | `free` | 1 | 3 | 6 | 5 |
| Premium | `premium` | 2 | 250 | 200 | unlimited |
| Pro | `pro` | 3 | 250 | 200 | unlimited |

Rank is used for inheritance: a user on rank-2 tier inherits the limits of rank-1 if no explicit row exists at rank-2. This allows tiers to be additive without duplicating every row.

`limit_value = -1` means unlimited. `null` (no row found at any tier in the chain) also means unlimited (fail-open).

## Active trip definition

A trip counts as "active" toward a user's limit if:
- The user is the owner of the trip's group (`groups.owner_id`), **or**
- The user has a non-removed, claimed `group_members` row for the trip's group.

Trips the user follows (via `trip_followers`) are **not** counted.

## How a user's tier is resolved

1. Query `user_tiers WHERE user_id = $1 AND effective_to IS NULL` — the current active row.
2. If no row exists, default to `free`.
3. The `tier_id` foreign key points to the `tiers` table row.

Only one `user_tiers` row is active at a time (`effective_to IS NULL`). When a tier is changed, the old row gets `effective_to = NOW()` and a new row is inserted. This preserves a full tier history for a user.

## How limit inheritance works

`getEffectiveLimit(userId, limitKey)` in `entitlementService.ts`:

1. Resolve the user's current tier and its rank.
2. Collect all tiers with `rank <= userTierRank`, sorted descending by rank.
3. Walk the list; return the first explicit `tier_limits` row found for the given `limitKey`.
4. If no row is found anywhere in the chain, return `null` (unlimited).

## How admin bypasses work

Admins bypass **limit checks** (trip count, traveler count, generation count) — they can always create trips, add members, and generate itineraries regardless of what limits are configured.

Admins do **not** bypass **feature flags** — if a flag is off, even admins cannot use that feature.

## How to add a new tier

1. Insert a row in the `tiers` table with a unique `key`, `display_name`, and `rank`.
2. Insert corresponding `tier_limits` rows.
3. Insert `tier_entitlements` rows if the new tier should restrict any features.
4. The seed in `initDb()` uses `ON CONFLICT (key) DO NOTHING` — existing rows are never overwritten by re-deployment.

## How to change a user's tier

**Via admin panel:** Navigate to Admin → Users → select user → Change Tier.

**Via admin API:**
```
PATCH /api/admin/users/:userId/tier
{ "tierKey": "premium", "reason": "Upgraded after payment" }
```

**Direct DB (emergency only):**
```sql
UPDATE user_tiers SET effective_to = NOW()
WHERE user_id = '<uuid>' AND effective_to IS NULL;

INSERT INTO user_tiers (id, user_id, tier_id, source, reason)
SELECT uuid_generate_v4(), '<uuid>', id, 'admin', 'Manual upgrade'
FROM tiers WHERE key = 'premium';
```
