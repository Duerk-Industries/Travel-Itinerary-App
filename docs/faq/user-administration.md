# User Administration FAQ

## What user admin actions are available in product?

Under `/api/account`:

- View profile
- Update name/email
- Change/set password
- Delete account

## What relationship management is implemented?

- Fellow travelers CRUD (`/api/account/fellow-travelers`)
- Family relationship create/accept/reject/update/delete (`/api/account/family*`)

## What group/member administration exists?

- Group list/create/delete
- Add/remove members (registered users or guests)
- Invite list/accept/reject/cancel
- Trip-level member add/remove routes under `/api/account/trips/:tripId/members`

## What happens on account deletion?

- Related data is cleaned up.
- In-memory mode includes explicit transactional cleanup/reassignment logic.
- Other providers use DB-adapter cleanup (`deleteWebUserAndCleanup`).

## Are there admin/ops scripts for users/trips?

- `npm run list-users`
- `npm run list-trips`
- `npm run accounts:seed` (local-guarded; requires `ALLOW_TEST_ACCOUNT_SEED=1`)

## Admin role and bootstrap

Certain email addresses are automatically granted `role = 'admin'` on first login via `ensureAdminBootstrap()`. The match is case-insensitive. A single audit log entry (`ADMIN_BOOTSTRAP_GRANTED`) is written; subsequent logins are no-ops.

To grant admin to an email not in the bootstrap list, set the role directly in the DB and have the user log in again:

```sql
UPDATE users SET role = 'admin' WHERE email = 'ops@example.com';
```

See [docs/admin.md](../admin.md) for the full admin system reference.

## Tier management

Every user is on a tier (`free`, `premium`, `pro`). Tiers control:
- Maximum active trips
- Maximum travelers per trip
- Maximum AI itinerary generations per month

To change a user's tier via the admin API:

```
PATCH /api/admin/users/:userId/tier
Authorization: Bearer <admin-token>
{ "tierKey": "premium", "reason": "Upgraded after payment" }
```

All tier changes are recorded in the `audit_log` table. See [docs/tiers.md](../tiers.md) for the full tier reference.

## Audit log

All admin mutations are recorded in the `audit_log` table. Query via the admin API:

```
GET /api/admin/audit-log?action=USER_TIER_CHANGED&limit=50
Authorization: Bearer <admin-token>
```

Recorded actions: `ADMIN_BOOTSTRAP_GRANTED`, `USER_TIER_CHANGED`, `USER_ROLE_GRANTED`, `USER_ROLE_REVOKED`, `FEATURE_FLAG_UPDATED`, `TIER_LIMIT_UPDATED`, `TIER_ENTITLEMENT_UPDATED`.

