# Feature Flags

## Overview

Feature flags are deployment-level toggles that enable or disable specific product features at runtime. The database is the runtime source of truth; the YAML config file provides seed defaults only.

## How flags work

A feature request passes two independent checks:

1. **Feature flag check** (`feature_flags` table): Is this feature currently enabled? Admin users are **not** exempt — if a flag is off, nobody uses that feature.
2. **Tier entitlement check** (`tier_entitlements` table): Does the user's tier grant access? Admin users **bypass** this check (if the flag is on, admins always have access).

Both checks use **fail-open** semantics: a missing row in either table is treated as "allowed". This prevents data seeding issues from accidentally locking users out of features.

## Defined flags

| Key | Default | Description |
|---|---|---|
| `ai_itinerary_generation` | on | AI-powered itinerary generation |
| `csv_export` | on | Export cost reports as CSV |
| `car_rentals` | on | Car rental tracking |
| `trip_sharing` | on | Share trips with other users |
| `trip_following` | on | Follow trips as read-only observer |
| `cost_tracking` | on | Expense and cost tracking |
| `multiple_groups` | on | Create more than one group |
| `trip_creation` | on | Create new trips |

## YAML seed vs DB runtime

The YAML config at `server/config/feature-flags.yaml` provides initial values. At startup, `seedEntitlementDefaults()` inserts any flags that do not yet exist in the `feature_flags` table using `ON CONFLICT (key) DO NOTHING`.

**The DB value always wins.** Changing the YAML file does not update an existing flag; use the admin API or admin panel to toggle at runtime.

## Precedence rules

For a user to use feature `F`:

1. `feature_flags` row for `F` must exist and `enabled = true` (or no row → allowed).
2. User's tier must have `tier_entitlements.is_allowed = true` for `F` (or no row → allowed).
3. User must be authenticated with a valid JWT.

If both checks pass: **allowed**. If either fails: **denied** with `EntitlementError`.

The flag check is evaluated first. If it fails, no tier check is performed.

## Single-environment model

There is one set of flags per database. All users in the same environment see the same flag state. There is no per-user or per-environment flag override. For staged rollouts, deploy to a separate environment.

## Adding a new feature

1. Add an entry to `server/config/feature-flags.yaml`:
   ```yaml
   my_new_feature:
     enabled: true
     description: "What this feature does"
   ```
2. Add a corresponding row to `features` seed in `initDb()` in `db.postgres.ts`.
3. Add tier entitlement seeds if the feature should be restricted by tier.
4. Add `assertCanUseFeature(userId, 'my_new_feature', role)` in the relevant route handler.
5. The flag will be seeded on next startup. Existing deployments will see the new flag created with the YAML default.

## Toggling a flag at runtime

**Via admin panel:** Admin → Feature Flags → enter reason → click Enable/Disable.

**Via admin API:**
```
PATCH /api/admin/features/ai_itinerary_generation/flag
{ "enabled": false, "reason": "Disabling for maintenance" }
```

The change takes effect immediately. The in-process flag cache has a 60-second TTL; new requests will reflect the change within one minute.

## Admin bypass note

Flags apply to **everyone including admins**. This is intentional — flags are operational controls, not permission controls. If AI generation is disabled for maintenance, admins are also blocked. To test a disabled feature as an admin, re-enable the flag rather than relying on a bypass.
