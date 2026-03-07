# Admin System

## Admin role

A user with `role = 'admin'` in the `users` table can:

- Access all `/api/admin/*` endpoints.
- Bypass tier **limits** (trip count, traveler count, AI generation count).
- Create trips with past end dates.
- Grant or revoke admin roles for other users.
- Change any user's tier.
- Toggle feature flags.
- Update tier limits and entitlements.
- View the audit log.

Admins do **not** bypass feature flags — if a flag is off, it is off for everyone.
Admins **cannot** revoke their own admin role (to prevent lockout).

## Bootstrap process

On every successful login or registration, `ensureAdminBootstrap(userId, email)` is called before the JWT is issued. If the email matches a hardcoded list (case-insensitive), the user is granted `role = 'admin'` automatically.

Current bootstrap emails:
- `bryan.duerk@gmail.com`
- `tristan.duerk@gmail.com`

The bootstrap is **idempotent** — it only runs if the user does not already have `role = 'admin'`. A single `ADMIN_BOOTSTRAP_GRANTED` audit log entry is written on the first grant; subsequent logins do not create duplicate entries.

## Admin bypasses — what is and is not bypassed

| Check | Admin bypasses? |
|---|---|
| Max active trips | Yes |
| Max travelers per trip | Yes |
| AI generations per month | Yes (counter still incremented for observability) |
| Past end date on trip creation | Yes |
| Feature flags (`feature_flags.enabled = false`) | **No** |
| Tier entitlements | Yes (if flag is on, admin always has access) |
| Authentication (`authenticate` middleware) | **No** — admins still need a valid JWT |

## Admin API reference

All endpoints are under `/api/admin` and require:
- A valid JWT (`authenticate` middleware)
- `role = 'admin'` in the JWT (`requireAdmin` middleware)
- A `reason` string (min 3 chars) on all mutating requests

### Feature flags

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/features` | List all feature flags |
| `PATCH` | `/api/admin/features/:key/flag` | Enable or disable a flag |

`PATCH` body: `{ "enabled": true/false, "reason": "..." }`

### Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | Paginated user list (`?search=&page=&limit=`) |
| `GET` | `/api/admin/users/:userId` | User detail with usage counters |
| `PATCH` | `/api/admin/users/:userId/tier` | Change user tier |
| `PATCH` | `/api/admin/users/:userId/role` | Grant or revoke admin role |

### Tiers

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/tiers` | All tiers with limits and entitlements |
| `PATCH` | `/api/admin/tiers/:tierKey/limits/:limitKey` | Update a numeric limit |
| `PATCH` | `/api/admin/tiers/:tierKey/features/:featureKey` | Update a tier entitlement |

### Usage and audit

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/user-data` | Aggregate usage stats (`?window=7d\|30d\|all-time`) |
| `GET` | `/api/admin/audit-log` | Paginated audit log (`?actorUserId=&targetUserId=&action=`) |

## Audit log

Every admin mutation writes a row to the `audit_log` table. Recorded actions:

| Action | Trigger |
|---|---|
| `ADMIN_BOOTSTRAP_GRANTED` | First-time admin grant via bootstrap email |
| `USER_TIER_CHANGED` | `PATCH /api/admin/users/:id/tier` |
| `USER_ROLE_GRANTED` | Role set to `admin` |
| `USER_ROLE_REVOKED` | Role set to `user` |
| `FEATURE_FLAG_UPDATED` | `PATCH /api/admin/features/:key/flag` |
| `TIER_LIMIT_UPDATED` | `PATCH /api/admin/tiers/:key/limits/:key` |
| `TIER_ENTITLEMENT_UPDATED` | `PATCH /api/admin/tiers/:key/features/:key` |

Each row includes `actor_user_id`, `target_user_id` (where applicable), `before_state` (JSONB), `after_state` (JSONB), and `reason`.

## Admin UI

The admin panel is accessible via the **Admin** button in the top navigation bar, visible only to users with `role = 'admin'`. It is built into the main React Native/web app as `app/tabs/AdminTab.tsx` and routes to:

- **Overview** — links to all sub-sections
- **Users** — search, view detail, change tier and role
- **Tiers** — view and inline-edit limits and entitlements
- **Feature Flags** — toggle flags with required reason
- **User Data** — usage stats with 7d / 30d / all-time window
- **Audit Log** — paginated chronological history

## Security model

- All enforcement is server-side. The `role` field in the JWT is read from the DB at every token issuance; there is no client-side admin gate that cannot be bypassed without also bypassing the server.
- `requireAdmin` middleware reads `req.user.role` from the verified JWT — if the token is tampered, JWT verification fails.

## How to provision the first admin in a new deployment

If neither bootstrap email matches your admin, set `role = 'admin'` directly in the DB:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-admin@example.com';
```

Then log out and log back in — the next token issued will carry `role: 'admin'`.
