# Test Plan

## Unit

- `getLimit(userId, limitKey)` resolves inherited limits by rank.
- `canUseFeature(userId, featureKey)` respects tier entitlements and feature flags.
- admin bootstrap grants admin to normalized bootstrap emails.
- `recordUsage(...)` writes counters and usage events.

## Integration

- Free tier cannot create a fourth active trip.
- Premium tier can exceed the Free active-trip cap.
- Non-admin users cannot create past-ended trips.
- Admin users can create past-ended trips.
- Free users cannot access premium-only cost tracking.
- Successful itinerary generations count toward monthly usage.
- Failed itinerary generations do not count.
- Reusing the same itinerary idempotency key does not double-charge usage.
- Admin search works for email, name, and user ID.
- Admin user-data endpoint returns trip counts, trip creations, AI usage, token usage, and API-call summaries.

## E2E

- Admin users can open `/admin/users`, `/admin/tiers`, `/admin/features`, and `/admin/user-data`.
- Non-admin users cannot use `/api/admin/*` even if they navigate directly.
- Admin UI remains hidden for non-admin users.

## Manual checks

- Toggle a feature flag in admin and verify the backend denies access immediately.
- Change a user's tier in admin and verify limits take effect without redeploy.
- Verify audit log rows are written for tier changes, role changes, tier edits, and flag edits.
