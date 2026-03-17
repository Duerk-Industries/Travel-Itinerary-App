# Test Plan

## Unit

- `getLimit(userId, limitKey)` resolves inherited limits by rank.
- `canUseFeature(userId, featureKey)` respects tier entitlements and feature flags.
- admin bootstrap grants admin to normalized bootstrap emails.
- `recordUsage(...)` writes counters and usage events.
- ingestion normalization converts text, HTML, PDF-like, and image-like payloads into the shared normalized document contract.
- ingestion extraction honors cache hits by `content_hash + logic_version`.
- ingestion token-budget circuit breaker dead-letters an over-budget job and creates no parsed items.
- parsed-item deduplication fingerprints suppress duplicate review items.
- assignment rules keep assignment atomic and preserve original extracted fields.

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
- Premium users can upload into the ingestion pipeline and see review items.
- Free users are blocked from ingestion endpoints.
- replaying the same manual upload does not create duplicate jobs or duplicate review items.
- edit, assign, and soft delete flows keep review-item state consistent.
- Gmail dry run and forwarded-mailbox routes remain feature-flag gated.

## E2E

- Admin users can open `/admin/users`, `/admin/tiers`, `/admin/features`, and `/admin/user-data`.
- Non-admin users cannot use `/api/admin/*` even if they navigate directly.
- Admin UI remains hidden for non-admin users.
- Premium users can reach the ingest tab, review parsed items, assign to an existing trip, and delete from the queue.
- Duplicate matches against assigned items show conflict state before assignment.

## Manual checks

- Toggle a feature flag in admin and verify the backend denies access immediately.
- Change a user's tier in admin and verify limits take effect without redeploy.
- Verify audit log rows are written for tier changes, role changes, tier edits, and flag edits.
- Confirm `Retry-After` is returned on ingestion quota exhaustion.
- Confirm raw source files are removed after successful parse and review persistence.
- Confirm disabled ingestion flags return `403` and the UI hides the related entry points.
- Confirm malformed or oversized files fail with user-safe error codes, not raw exception strings.
