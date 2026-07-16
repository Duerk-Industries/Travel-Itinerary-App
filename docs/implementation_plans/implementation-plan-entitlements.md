# Entitlements, Tiers, Feature Flags, Admin UI & Usage Tracking — Implementation Plan

**Status:** Planning complete. Ready for implementation.
**Last updated:** 2026-03-06

---

## 1. Conflict Analysis Against Confirmed Decisions

The following decisions were evaluated against the repository architecture. All are compatible
unless noted.

---

### Decision: Admin bootstrap on first successful signup/login

**Status: Compatible, with one integration caveat.**

`createToken(...)` is called in **six distinct places** across the codebase:

| File | Location | Notes |
|---|---|---|
| `server/src/routes/webAuthRoutes.ts` | `POST /register` success | Only fires when `emailVerified = true` |
| `server/src/routes/webAuthRoutes.ts` | `POST /login` success | Fires every login |
| `server/src/routes/webAuthRoutes.ts` | `GET /confirm` success | Email confirmation path |
| `server/src/routes/webAuthRoutes.ts` | `PATCH /profile` | Re-issues token on profile update |
| `server/src/routes/authRoutes.ts` | `POST /register` success | Device auth path |
| `server/src/app.ts` | Google OAuth callback | `passport.authenticate` success handler |

The `TokenPayload` interface in `auth.ts` currently has no `role` field. Adding `role` to the
token requires updating every `createToken(...)` call to pass the user's current role.

**Resolution:** Add a `getUserRole(userId)` db function. In every auth success path, fetch the role
immediately after the user record is resolved and pass it to `createToken`. The admin bootstrap
check (`ensureAdminBootstrap(userId, email)`) runs before `createToken` is called so the first
token is issued with the correct role.

The `PATCH /profile` re-issuance path does not trigger bootstrap — it only issues a refreshed
token. Role is read from DB at that point too, so any role granted between initial login and
profile update is reflected without requiring a fresh login.

---

### Decision: Database runtime truth; YAML is seed-only

**Status: Compatible, with an important pattern distinction.**

The existing `authFlags.ts` and `apiLimits.ts` loaders use a **file-mtime-cached, request-time
read** pattern — YAML is the runtime source of truth for those configs. This pattern must **not**
be followed for the new feature flags.

The new `featureFlags.ts` loader is **startup-only** — it is called once inside
`seedEntitlementDefaults()` which runs after `initDb()`. It never runs at request time. All
request-time feature flag reads go to the DB via `entitlementService.ts`.

This distinction must be documented in `docs/feature-flags.md` to prevent future developers from
following the `authFlags.ts` pattern for entitlements.

---

### Decision: One centralized entitlement service; refactor existing checks to use it

**Status: Compatible. "Existing checks" clarified.**

The following existing authorization patterns exist but are **not** subject to refactoring because
they are orthogonal to tier/feature entitlements:

- `ensureUserInTrip` / `ensureUserCanReadTrip` — membership checks (is user in this group?)
- `reserveApiUsageOrThrow` in `usageLimiter.ts` — infrastructure quota checks (external API key limits)
- `isPasswordSetupRequired` in `authenticate` — auth flow state check

These are distinct concerns and must remain separate.

The centralization principle applies to all **new** user-facing tier/limit/feature checks. They
all route through `entitlementService.ts`. The existing `getAuthFlag(...)` pattern in route
handlers (e.g., `accountRoutes.ts` lines 96–165) also stays as-is — those are system-level auth
feature flags, not user tier entitlements.

---

### Decision: Require reasons for admin mutations

**Status: Compatible. Touch point identified.**

The `reason` field is required in the request body for all admin mutation endpoints:
`PATCH /api/admin/users/:id/tier`, `PATCH /api/admin/users/:id/role`,
`PATCH /api/admin/tiers/:key/limits/:key`, `PATCH /api/admin/features/:key/flag`.

A missing or blank `reason` returns HTTP 400. Reason is stored in `user_tiers.reason` and
`audit_log.reason`. Minimum length: 3 characters.

---

### Decision: Admin bypasses trip past-end-date restriction, active trip count, and AI generation count

**Status: Compatible. Bypass points identified.**

Three enforcement points check `req.user.role` before running limit logic:

1. `POST /api/trips` — active trip count check and past-end-date check
2. `PATCH /api/trips/:id` — past-end-date check on update
3. `POST /api/itinerary` and `POST /api/itinerary/async` — monthly generation check

Admin users skip these three checks. They do **not** skip:
- `authenticate` middleware
- Membership checks (`ensureUserInTrip`)
- Feature flag checks (`isFeatureEnabled`) — flags are deployment controls, not tier controls
- Audit log writes
- Server-side RBAC (`requireAdmin`) on `/api/admin/*`

---

## 2. Phased Implementation Plan

Each phase is independently mergeable and deployable. Phases 0–2 are purely additive
(no behavior change). Phases 3+ activate enforcement.

---

### Phase 0 — Schema, types, seed data *(additive only)*

**Goal:** All new tables exist. All new types exist. No behavior change.

- Add `role TEXT NOT NULL DEFAULT 'user'` column to `users` table
- Create 8 new tables (see Section 3)
- Insert seed data: tiers, features, tier_entitlements, tier_limits, feature_flags
- Assign free tier to all existing users in a `user_tiers` row
- Add new TypeScript types to `server/src/types.ts`
- Add new DB facade functions to `server/src/db.ts`
- Implement Postgres functions in `server/src/db.postgres.ts`
- Implement Firestore functions in `server/src/db.firebase.ts`
- Extend pg-mem teardown in test setup

**Files changed:** `types.ts`, `db.ts`, `db.postgres.ts`, `db.firebase.ts`, `pg-mem-setup.ts`

---

### Phase 1 — Auth extensions *(additive only)*

**Goal:** JWT carries `role`. Admin bootstrap fires. `requireAdmin` exists. No enforcement yet.

- Add `role: 'user' | 'admin'` to `TokenPayload` in `auth.ts`
- Update all 6 `createToken(...)` call sites to pass `role` fetched from DB
- Create `server/src/middleware/requireAdmin.ts`
- Create `ensureAdminBootstrap(userId, email)` in `entitlementService.ts`
  - Normalizes email to lowercase
  - Checks against bootstrap list: `['bryan.duerk@gmail.com', 'tristan.duerk@gmail.com']`
  - If match and role is not already 'admin': sets `users.role = 'admin'` and writes audit_log
  - Idempotent: safe to call on every login, only writes audit event on first grant
- Call `ensureAdminBootstrap` in each auth success path before `createToken`
- Add `role` to `StoredSession` type in `app/utils/session.ts`
- Parse and store `role` in session in `app/App.tsx`

**Files changed:** `auth.ts`, `webAuthRoutes.ts`, `authRoutes.ts`, `app.ts`, `requireAdmin.ts`
(new), `entitlementService.ts` (new, bootstrap only), `session.ts`, `App.tsx`

---

### Phase 2 — Feature flag infrastructure *(additive only)*

**Goal:** Feature flags exist in DB. Admin can read and toggle them. No route enforcement yet.

- Create `server/config/feature-flags.yaml`
- Create `server/src/config/featureFlags.ts` (startup-only seed loader)
- Create `seedEntitlementDefaults()` in `entitlementService.ts`
  - Upserts tiers, features, tier_entitlements, tier_limits, feature_flags from YAML + code
  - Called in `server/src/index.ts` after `initDb()`
- Implement `isFeatureEnabled(featureKey: string): Promise<boolean>` in `entitlementService.ts`
  - Reads from `feature_flags` table (no YAML at request time)
- Create `server/src/routes/adminRoutes.ts` with:
  - `GET /api/admin/features` — list all features + flag states
  - `PATCH /api/admin/features/:key/flag` — toggle flag, require reason, write audit_log
- Mount admin routes in `app.ts`: `app.use('/api/admin', authenticate, requireAdmin, adminRoutes)`

**Files changed:** `feature-flags.yaml` (new), `featureFlags.ts` (new), `entitlementService.ts`,
`adminRoutes.ts` (new), `app.ts`, `index.ts`

---

### Phase 3 — Full entitlement engine *(additive only)*

**Goal:** All entitlement functions implemented and unit-tested. No route enforcement yet.

Implement in `entitlementService.ts`:

- `getUserTier(userId)` — returns current tier (resolves via `user_tiers` WHERE `effective_to IS NULL`)
- `canUseFeature(userId, featureKey)` — feature flag check AND tier entitlement check; admin bypasses tier check but not flag check
- `getLimit(userId, limitKey)` — returns limit_value for user's tier; resolves via rank inheritance (walk down ranks until a `tier_limits` row is found); returns `Infinity` when `limit_value = -1`
- `checkLimit(userId, limitKey, currentValue)` — compares to `getLimit`; throws `EntitlementLimitError` if `currentValue >= limit` and user is not admin
- `recordUsage(userId, metricKey, amount, windowKey?)` — upserts `usage_counters` row; defaults to current UTC month window plus 'all-time'; atomic increment via single UPDATE statement
- `getUsage(userId, metricKey, windowKey)` — returns current counter value
- `countActiveTrips(userId)` — returns count of active trips where user is owner or non-removed group member
- `atomicIncrementIfUnderLimit(userId, metricKey, windowKey, limit)` — single SQL `UPDATE ... SET count = count + 1 WHERE count < $limit RETURNING count`; returns `{ allowed: boolean; newCount: number }`

Create `server/src/errors.ts`:
- `EntitlementLimitError` — mirrors `ApiLimitExceededError` structure
- `FeatureDisabledError`

**Files changed:** `entitlementService.ts`, `errors.ts` (new), `db.ts`, `db.postgres.ts`, `db.firebase.ts`

---

### Phase 4 — Usage tracking + token counting

**Goal:** Usage is recorded for itinerary generation. Token counts flow from OpenAI responses.

- Modify `OpenAiChatCompletionResponse` type in `openaiApi.ts` to include `usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }`
- Update `postOpenAiChatCompletion` to return token counts alongside content
- Update `openaiCallers.ts` to thread token counts up through return values
- Update `itineraryPromptPlanService.ts` to accumulate total tokens across all 5 pipeline stages and return `{ ..., tokensUsed: number }` in the result
- In `itineraryRoutes.ts` success path: call `recordUsage(userId, 'ai_itinerary_generations', 1)` and `recordUsage(userId, 'openai_tokens_total', tokensUsed)`

**Files changed:** `openaiApi.ts`, `openaiCallers.ts`, `itineraryPromptPlanService.ts`, `itineraryRoutes.ts`

---

### Phase 5 — Active trip limit enforcement

**Goal:** Trip creation is gated. Past-date creation blocked for non-admins.

In `tripRoutes.ts`, `POST /` (createTrip path, line ~384):
1. Check `isFeatureEnabled('trip_creation')` — currently always true; provides future kill-switch
2. If not admin: check `countActiveTrips(userId) >= getLimit(userId, 'max_active_trips')` → return 429 `EntitlementLimitError`
3. If not admin and `endDate < today UTC` → return 403

Same logic on `POST /` wizard path (`createTripWithGroupAndMembers`, line ~436).

Add `PATCH /api/trips/:id` past-date guard: if non-admin sets `endDate` to past → return 403.

**Files changed:** `tripRoutes.ts`

---

### Phase 6 — AI itinerary generation enforcement

**Goal:** Monthly generation limit enforced atomically. Per-IP rate limiting added.

In `itineraryRoutes.ts`, before generation begins (both `POST /` and `POST /async`):
1. `isFeatureEnabled('ai_itinerary_generation')` — if false, return 403
2. If not admin: `atomicIncrementIfUnderLimit(userId, 'ai_itinerary_generations', currentMonthKey, limit)` — if `allowed = false`, return 429
3. Idempotency: if `idempotency_key` header/body present, check `generation_idempotency` table; if pending/completed, return cached status
4. Per-IP rate limit: simple in-memory `Map<ip, {count, windowStart}>` (same pattern as `usageLimiter.ts`); 10 requests per 10 minutes per IP; configurable via env var

Note: usage increment happens **before** the OpenAI call. If the call fails, the counter is NOT
rolled back (generation attempt was made). This is consistent with the spec's "5 successful runs"
intent — **clarification needed** (see Section 9).

**Files changed:** `itineraryRoutes.ts`, `entitlementService.ts`

---

### Phase 7 — Traveler limit enforcement

**Goal:** Group member add is gated by `max_travelers_per_trip`.

In `accountRoutes.ts`, group member add routes:
1. Count current non-removed group members for the trip's group
2. If count >= `getLimit(userId, 'max_travelers_per_trip')` and not admin → return 429

**Files changed:** `accountRoutes.ts`

---

### Phase 8 — Admin API (users, tiers, user-data, audit-log)

**Goal:** Full admin API surface available.

Expand `adminRoutes.ts`:
- `GET /api/admin/users` — paginated (page, limit, search by email/name/userId)
- `GET /api/admin/users/:userId` — user detail + tier + usage summary
- `PATCH /api/admin/users/:userId/tier` — change tier (require reason)
- `PATCH /api/admin/users/:userId/role` — grant/revoke admin (require reason)
- `GET /api/admin/tiers` — all tiers with entitlements and limits
- `PATCH /api/admin/tiers/:tierKey/limits/:limitKey` — upsert limit (require reason)
- `PATCH /api/admin/tiers/:tierKey/features/:featureKey` — upsert entitlement (require reason)
- `GET /api/admin/user-data` — aggregate stats (window=7d|30d|all-time, page, limit)
- `GET /api/admin/audit-log` — paginated audit log

All mutations write to `audit_log`.

**Files changed:** `adminRoutes.ts`, `db.ts`, `db.postgres.ts`, `db.firebase.ts`

---

### Phase 9 — Admin UI (frontend)

**Goal:** Admin tab and four sub-pages visible only to admin users.

- Add admin page types to `App.tsx`
- Show admin tab in nav bar when `userRole === 'admin'`
- Create `app/tabs/AdminTab.tsx` (landing with 4 links)
- Create `app/tabs/AdminUsersTab.tsx`
- Create `app/tabs/AdminTiersTab.tsx`
- Create `app/tabs/AdminFeaturesTab.tsx`
- Create `app/tabs/AdminUserDataTab.tsx`
- Add `GET /api/entitlements/me` endpoint for frontend hints

**Files changed:** `App.tsx`, 5 new tab files

---

### Phase 10 — Tests

**Goal:** All required test coverage in place.

See Section 7 for full test specification.

---

### Phase 11 — Docs

**Goal:** All required documentation in place.

- `docs/tiers.md`
- `docs/admin.md`
- `docs/feature-flags.md`
- Update `CLAUDE.md`
- Update `docs/faq/testing-and-coverage.md`
- Update `docs/faq/api-usage.md`
- Update `docs/faq/user-administration.md`

---

## 3. Data Model and Migration Plan

### Migration approach

All schema changes are added to `initDb()` in `db.postgres.ts` using the existing pattern of
`CREATE TABLE IF NOT EXISTS` followed by `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for backward
compatibility. Seed data is upserted with `ON CONFLICT ... DO NOTHING` so live DB values are
never overwritten. New tables are added to the `USE_IN_MEMORY_DB` cleanup block at the end
of `initDb()`.

### New tables (Postgres DDL)

```sql
-- 1. Role on users (column only, no separate table)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE role <> 'user';

-- 2. Tiers
CREATE TABLE IF NOT EXISTS tiers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key          TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  rank         INTEGER NOT NULL UNIQUE,       -- 1=free, 2=premium, 3=pro; higher inherits lower
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Feature registry
CREATE TABLE IF NOT EXISTS features (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key             TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL DEFAULT '',
  default_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 4. Tier → feature entitlements (inheritance resolved in service layer via rank)
CREATE TABLE IF NOT EXISTS tier_entitlements (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier_id    UUID NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  is_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tier_id, feature_id)
);

-- 5. Tier numeric limits
CREATE TABLE IF NOT EXISTS tier_limits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier_id     UUID NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  limit_key   TEXT NOT NULL,
  limit_value INTEGER NOT NULL,               -- -1 = unlimited
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (tier_id, limit_key)
);

-- 6. User tier assignment history (append-only; current = WHERE effective_to IS NULL)
CREATE TABLE IF NOT EXISTS user_tiers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier_id        UUID NOT NULL REFERENCES tiers(id),
  source         TEXT NOT NULL DEFAULT 'system',  -- 'system' | 'admin'
  reason         TEXT,
  assigned_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  effective_from TIMESTAMP NOT NULL DEFAULT NOW(),
  effective_to   TIMESTAMP,                        -- NULL = currently active
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_tiers_current
  ON user_tiers(user_id, effective_from DESC)
  WHERE effective_to IS NULL;

-- 7. Feature flags (deployment-level toggle; DB is runtime truth)
CREATE TABLE IF NOT EXISTS feature_flags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key        TEXT NOT NULL UNIQUE,
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  scope      TEXT NOT NULL DEFAULT 'global',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 8. Per-user usage counters
CREATE TABLE IF NOT EXISTS usage_counters (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  window_key TEXT NOT NULL,   -- 'all-time' | 'YYYY-MM' (UTC calendar month)
  count      BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, metric_key, window_key)
);
CREATE INDEX IF NOT EXISTS idx_usage_counters_user_metric
  ON usage_counters(user_id, metric_key, window_key);

-- 9. Idempotency keys for AI generation requests
CREATE TABLE IF NOT EXISTS generation_idempotency (
  key        TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'completed' | 'failed'
  result_ref TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL                -- set to NOW() + INTERVAL '24 hours'
);
CREATE INDEX IF NOT EXISTS idx_gen_idempotency_user
  ON generation_idempotency(user_id, created_at DESC);

-- 10. System audit log (separate from trip_activity)
CREATE TABLE IF NOT EXISTS audit_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  before_state   JSONB,
  after_state    JSONB,
  reason         TEXT,
  ip_address     TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON audit_log(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
```

### Seed data upserted in `initDb()`

```sql
-- Tiers (ON CONFLICT DO NOTHING — DB rank values are never overwritten)
INSERT INTO tiers (id, key, display_name, rank)
SELECT uuid_generate_v4(), key, display_name, rank
FROM (VALUES
  ('free',    'Free',    1),
  ('premium', 'Premium', 2),
  ('pro',     'Pro',     3)
) AS t(key, display_name, rank)
ON CONFLICT (key) DO NOTHING;

-- Features (ON CONFLICT DO NOTHING)
INSERT INTO features (key, description, default_enabled)
VALUES
  ('ai_itinerary_generation',  'AI-powered itinerary generation',     true),
  ('csv_export',               'Export cost reports as CSV',           true),
  ('car_rentals',              'Car rental tracking',                  true),
  ('trip_sharing',             'Share trips with other users',         true),
  ('trip_following',           'Follow trips as read-only observer',   true),
  ('cost_tracking',            'Expense and cost tracking',            true),
  ('multiple_groups',          'Create more than one group',           true),
  ('trip_creation',            'Create new trips',                     true)
ON CONFLICT (key) DO NOTHING;

-- All features allowed at all tiers initially (limits govern behavior, not entitlements)
-- Seeded in application code (entitlementService.seedEntitlementDefaults) after tiers+features exist

-- Tier limits
-- Free
INSERT INTO tier_limits (tier_id, limit_key, limit_value)
SELECT t.id, l.limit_key, l.limit_value
FROM tiers t, (VALUES
  ('max_active_trips',                     3),
  ('max_travelers_per_trip',               6),
  ('ai_itinerary_generations_per_month',   5)
) AS l(limit_key, limit_value)
WHERE t.key = 'free'
ON CONFLICT (tier_id, limit_key) DO NOTHING;

-- Premium
INSERT INTO tier_limits (tier_id, limit_key, limit_value)
SELECT t.id, l.limit_key, l.limit_value
FROM tiers t, (VALUES
  ('max_active_trips',                   250),
  ('max_travelers_per_trip',             200),
  ('ai_itinerary_generations_per_month',  -1)
) AS l(limit_key, limit_value)
WHERE t.key = 'premium'
ON CONFLICT (tier_id, limit_key) DO NOTHING;

-- Pro (explicit rows matching premium — avoids silent coupling)
INSERT INTO tier_limits (tier_id, limit_key, limit_value)
SELECT t.id, l.limit_key, l.limit_value
FROM tiers t, (VALUES
  ('max_active_trips',                   250),
  ('max_travelers_per_trip',             200),
  ('ai_itinerary_generations_per_month',  -1)
) AS l(limit_key, limit_value)
WHERE t.key = 'pro'
ON CONFLICT (tier_id, limit_key) DO NOTHING;

-- Feature flags (DB seed; admin edits override; ON CONFLICT DO NOTHING)
INSERT INTO feature_flags (key, enabled)
VALUES
  ('ai_itinerary_generation', true),
  ('csv_export',              true),
  ('car_rentals',             true),
  ('trip_sharing',            true),
  ('trip_following',          true),
  ('cost_tracking',           true),
  ('multiple_groups',         true),
  ('trip_creation',           true)
ON CONFLICT (key) DO NOTHING;

-- Assign free tier to all existing users without a user_tiers row
INSERT INTO user_tiers (id, user_id, tier_id, source)
SELECT uuid_generate_v4(), u.id, t.id, 'system'
FROM users u
JOIN tiers t ON t.key = 'free'
WHERE NOT EXISTS (
  SELECT 1 FROM user_tiers ut WHERE ut.user_id = u.id AND ut.effective_to IS NULL
)
ON CONFLICT DO NOTHING;
```

### Firestore collection schema

Each Postgres table maps to a Firestore collection. Compound uniqueness is handled via
document IDs:

| Collection | Document ID | Notes |
|---|---|---|
| `tiers` | `{key}` | `free`, `premium`, `pro` |
| `features` | `{key}` | Feature registry |
| `tier_entitlements` | `{tierKey}_{featureKey}` | |
| `tier_limits` | `{tierKey}_{limitKey}` | |
| `user_tiers` | UUID | Query by `userId + effectiveTo == null` |
| `feature_flags` | `{key}` | |
| `usage_counters` | `{userId}_{metricKey}_{windowKey}` | |
| `generation_idempotency` | `{key}` | |
| `audit_log` | UUID | Collection group queries |

Atomic counter increment uses `FieldValue.increment(amount)` inside a Firestore transaction.
The limit check + increment is done as: read counter doc, check count < limit, update with
increment — all within a single Firestore transaction.

### New types in `server/src/types.ts`

```typescript
export type UserRole = 'user' | 'admin';
export type TierKey = 'free' | 'premium' | 'pro' | string; // extensible

export interface Tier {
  id: string;
  key: TierKey;
  displayName: string;
  rank: number;
  isActive: boolean;
  createdAt: string;
}

export interface Feature {
  id: string;
  key: string;
  description: string;
  defaultEnabled: boolean;
  createdAt: string;
}

export interface TierEntitlement {
  id: string;
  tierId: string;
  featureId: string;
  isAllowed: boolean;
  createdAt: string;
}

export interface TierLimit {
  id: string;
  tierId: string;
  limitKey: string;
  limitValue: number;  // -1 = unlimited
  createdAt: string;
}

export interface UserTier {
  id: string;
  userId: string;
  tierId: string;
  source: 'system' | 'admin';
  reason?: string | null;
  assignedBy?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdAt: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  scope: 'global';
  updatedBy?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface UsageCounter {
  id: string;
  userId: string;
  metricKey: string;
  windowKey: string;
  count: number;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: AuditAction;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export type AuditAction =
  | 'ADMIN_BOOTSTRAP_GRANTED'
  | 'USER_ROLE_GRANTED'
  | 'USER_ROLE_REVOKED'
  | 'USER_TIER_CHANGED'
  | 'TIER_LIMIT_UPDATED'
  | 'TIER_ENTITLEMENT_UPDATED'
  | 'FEATURE_FLAG_UPDATED';
```

Also update `User` interface:
```typescript
export interface User {
  // ... existing fields ...
  role: UserRole;  // ADD — default 'user'
}
```

---

## 4. API Design and Route Responsibilities

### Entitlement endpoint (authenticated, non-admin)

```
GET /api/entitlements/me
```
Response:
```json
{
  "tier": "free",
  "tierDisplayName": "Free",
  "limits": {
    "max_active_trips": 3,
    "max_travelers_per_trip": 6,
    "ai_itinerary_generations_per_month": 5
  },
  "features": {
    "ai_itinerary_generation": true,
    "csv_export": true
  },
  "usage": {
    "active_trips": 2,
    "ai_itinerary_generations_this_month": 3
  }
}
```
This is a UI hint endpoint. All enforcement is server-side.

### Admin routes — all behind `authenticate` + `requireAdmin`

```
GET    /api/admin/users
       ?search=&page=1&limit=50
       Returns: { users: UserAdminView[], total: number, page: number, limit: number }

GET    /api/admin/users/:userId
       Returns: UserAdminView with usage summary

PATCH  /api/admin/users/:userId/tier
       Body: { tierKey: string, reason: string }
       Returns: { userId, tierKey, previousTierKey, auditId }

PATCH  /api/admin/users/:userId/role
       Body: { role: 'admin' | 'user', reason: string }
       Returns: { userId, role, previousRole, auditId }

GET    /api/admin/tiers
       Returns: TierAdminView[] with entitlements and limits

PATCH  /api/admin/tiers/:tierKey/limits/:limitKey
       Body: { limitValue: number, reason: string }
       Returns: { tierKey, limitKey, limitValue, previousValue, auditId }

PATCH  /api/admin/tiers/:tierKey/features/:featureKey
       Body: { isAllowed: boolean, reason: string }
       Returns: { tierKey, featureKey, isAllowed, auditId }

GET    /api/admin/features
       Returns: FeatureAdminView[] (feature + flag state)

PATCH  /api/admin/features/:key/flag
       Body: { enabled: boolean, reason: string }
       Returns: { key, enabled, previousEnabled, auditId }

GET    /api/admin/user-data
       ?window=7d|30d|all-time&page=1&limit=50
       Returns: { stats: UserDataRow[], total: number, window: string, generatedAt: string }
       Cached for 60 seconds (in-memory, keyed by window+page)

GET    /api/admin/audit-log
       ?actorUserId=&targetUserId=&action=&page=1&limit=50
       Returns: { entries: AuditLogEntry[], total: number, page: number, limit: number }
```

### Error response contract

All entitlement errors return structured JSON:

```json
// Feature flag disabled (HTTP 403)
{
  "error": "Feature not available",
  "code": "FEATURE_DISABLED",
  "featureKey": "ai_itinerary_generation"
}

// Limit exceeded (HTTP 429)
{
  "error": "Limit reached",
  "code": "ENTITLEMENT_LIMIT_EXCEEDED",
  "limitKey": "max_active_trips",
  "limit": 3,
  "current": 3,
  "tier": "free"
}

// Missing reason on admin mutation (HTTP 400)
{
  "error": "reason is required for this action",
  "code": "REASON_REQUIRED"
}
```

### Modified existing routes

| Route | Change |
|---|---|
| `POST /api/trips` | Phase 5: active trip count check + past-date guard |
| `PATCH /api/trips/:id` | Phase 5: past-date guard |
| `POST /api/itinerary` | Phase 6: feature flag + monthly limit check + idempotency |
| `POST /api/itinerary/async` | Phase 6: same as above |
| Group member add in `accountRoutes.ts` | Phase 7: traveler count check |

### Enforcement call sequence (all gated routes)

```
1. authenticate (existing middleware — always present)
2. isFeatureEnabled(featureKey)          → 403 FeatureDisabledError if false (all users)
3. if NOT admin:
     checkLimit(userId, limitKey, current) → 429 EntitlementLimitError if exceeded
4. if idempotency_key provided:
     check generation_idempotency table    → return cached result if found
5. main operation
6. recordUsage(userId, metricKey, 1)       → fire-and-forget (does not fail request)
```

---

## 5. UI Route Plan

### Page type additions

```typescript
// Add to existing Page union in App.tsx:
type AdminPage =
  | 'admin'
  | 'admin-users'
  | 'admin-tiers'
  | 'admin-features'
  | 'admin-user-data';
```

### Session additions

```typescript
// StoredSession in session.ts:
export type StoredSession = {
  token: string;
  name: string;
  email?: string;
  page?: string;
  pageHistory?: string[];
  tripId?: string | null;
  role?: 'user' | 'admin';   // ADD
  expiresAt: number;
};
```

### Nav bar admin tab

In `App.tsx` tab bar rendering: add admin tab conditionally.
```tsx
{userRole === 'admin' && (
  <TouchableOpacity onPress={() => navigateTo('admin')}>
    <Text>Admin</Text>
  </TouchableOpacity>
)}
```

### Admin tab file responsibilities

| File | Route | API calls |
|---|---|---|
| `AdminTab.tsx` | `admin` | None — landing page with 4 links |
| `AdminUsersTab.tsx` | `admin-users` | `GET /api/admin/users`, `PATCH /api/admin/users/:id/tier`, `PATCH /api/admin/users/:id/role` |
| `AdminTiersTab.tsx` | `admin-tiers` | `GET /api/admin/tiers`, `PATCH /api/admin/tiers/:key/limits/:key`, `PATCH /api/admin/tiers/:key/features/:key` |
| `AdminFeaturesTab.tsx` | `admin-features` | `GET /api/admin/features`, `PATCH /api/admin/features/:key/flag` |
| `AdminUserDataTab.tsx` | `admin-user-data` | `GET /api/admin/user-data` |

### Platform guard

All admin tab files return `null` immediately when `Platform.OS !== 'web'`. Security is
server-side; this is a UX guard only.

### Admin sub-page navigation

Uses existing `setActivePage` + `setPageHistory` stack. Admin sub-pages push onto the history
stack so the existing back button works. The admin landing page is the history anchor.

---

## 6. Feature Flag Strategy

### Scope model: single-environment (confirmed)

One set of flags, one scope (`'global'`). Flags apply to all users in the environment. The admin
panel provides runtime control sufficient for toggling features in any deployment without
needing environment-specific YAML files. The `scope` column is reserved for future multi-
environment support if needed.

### Precedence (enforced in `entitlementService.ts`)

```
1. authenticate middleware passes (always required — no bypass)
2. isFeatureEnabled(featureKey) returns true (no admin bypass — flags are deployment controls)
3. if NOT admin: canUseFeature(userId, featureKey) via tier entitlement check
4. if NOT admin: checkLimit(userId, limitKey, currentValue) passes
5. (for AI generation): atomic increment succeeds
```

### YAML loader (`featureFlags.ts`) lifecycle

```
Server startup → initDb() → seedEntitlementDefaults() → featureFlags.ts reads YAML →
INSERT INTO feature_flags ... ON CONFLICT DO NOTHING → done.

Request time → entitlementService.isFeatureEnabled() → SELECT FROM feature_flags → done.
```

The YAML loader is **never called at request time**. If the `feature_flags` table already has a
row for a key, YAML has no effect on it.

### Adding a new feature flag

1. Add entry to `server/config/feature-flags.yaml`
2. Add feature entry to the seed data `INSERT INTO features` block in `db.postgres.ts`
3. Deploy — the new flag is seeded on next server startup
4. Toggle via admin panel as needed

### Feature flag YAML structure

```yaml
# server/config/feature-flags.yaml
# Seed defaults only. Do not edit at runtime — use the admin panel.
# DB values take precedence after first deployment.

flags:
  ai_itinerary_generation:
    description: "AI-powered trip itinerary generation via OpenAI"
    default_enabled: true

  csv_export:
    description: "Export cost reports as CSV"
    default_enabled: true

  car_rentals:
    description: "Car rental tracking"
    default_enabled: true

  trip_sharing:
    description: "Share trips with other users via invite"
    default_enabled: true

  trip_following:
    description: "Follow trips as read-only observer"
    default_enabled: true

  cost_tracking:
    description: "Expense and cost tracking"
    default_enabled: true

  multiple_groups:
    description: "Create more than one travel group"
    default_enabled: true

  trip_creation:
    description: "Create new trips (kill-switch for platform use)"
    default_enabled: true
```

---

## 7. Test Plan

### Test helper additions (`server/__tests__/helpers.ts`)

```typescript
export const makeAdminUser = async (pool: Pool, user: TestUser) => {
  const { token, userId } = await registerAndLoginWebUser(pool, user);
  await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
  const relogin = await loginWebUser(user);
  return { token: relogin.body.token as string, userId };
};

export const setUserTier = async (pool: Pool, userId: string, tierKey: string) => {
  await pool.query(
    `UPDATE user_tiers SET effective_to = NOW() WHERE user_id = $1 AND effective_to IS NULL`,
    [userId]
  );
  await pool.query(
    `INSERT INTO user_tiers (id, user_id, tier_id, source)
     SELECT uuid_generate_v4(), $1, id, 'test'
     FROM tiers WHERE key = $2`,
    [userId, tierKey]
  );
};
```

### New test files

#### `server/__tests__/entitlements.test.ts` — Unit, pg-mem

| Test | Description |
|---|---|
| `getLimit free` | Returns 3 for `max_active_trips` on free tier |
| `getLimit premium` | Returns 250 for `max_active_trips` on premium tier |
| `getLimit unlimited` | Returns `Infinity` when `limit_value = -1` |
| `getLimit pro inheritance` | Pro returns 250 (own explicit row) |
| `canUseFeature flag off` | Returns false when feature_flag.enabled = false (any tier) |
| `canUseFeature admin flag off` | Admin also returns false when feature_flag.enabled = false |
| `canUseFeature tier not entitled` | Returns false when tier has `is_allowed = false` |
| `canUseFeature admin tier check` | Admin returns true regardless of tier entitlement |
| `checkLimit under` | Does not throw when current < limit |
| `checkLimit at limit` | Throws `EntitlementLimitError` when current >= limit |
| `checkLimit unlimited` | Never throws when limit = Infinity |
| `checkLimit admin bypass` | Admin user never throws even when over limit |
| `countActiveTrips` | Counts trips with null endDate as active |
| `countActiveTrips past` | Does not count trips where endDate < today |
| `countActiveTrips follower` | Does not count followed trips |
| `atomicIncrement allowed` | Returns `{ allowed: true }` when count < limit |
| `atomicIncrement blocked` | Returns `{ allowed: false }` when count >= limit |
| `atomicIncrement concurrent` | Two concurrent requests at limit = 4 for limit = 5: both succeed; at limit = 5: one succeeds, one fails |

#### `server/__tests__/admin-bootstrap.test.ts` — Integration, pg-mem

| Test | Description |
|---|---|
| `bootstrap named email` | `bryan.duerk@gmail.com` gets role='admin' on first login |
| `bootstrap case insensitive` | `BRYAN.DUERK@GMAIL.COM` matches |
| `bootstrap audit event` | `audit_log` row with action `ADMIN_BOOTSTRAP_GRANTED` written |
| `bootstrap idempotent` | Second login does not write duplicate audit event |
| `bootstrap non-matching` | Other emails do not get role='admin' |
| `bootstrap tristan` | `tristan.duerk@gmail.com` also granted |
| `token includes role` | JWT issued after bootstrap includes `role: 'admin'` |

#### `server/__tests__/tiers-limits.test.ts` — Integration, pg-mem + supertest

| Test | Description |
|---|---|
| `free trip limit blocked` | POST /api/trips fails with 429 when free user has 3 active trips |
| `free trip limit allowed` | POST /api/trips succeeds on trip 1-3 |
| `premium not blocked` | POST /api/trips succeeds with 4+ trips for premium user |
| `admin bypasses count` | Admin can create trip 4+ |
| `past date blocked` | Non-admin POST /api/trips with endDate in past returns 403 |
| `past date admin allowed` | Admin POST /api/trips with past endDate succeeds |
| `past date patch blocked` | Non-admin PATCH /api/trips/:id setting past endDate returns 403 |
| `active trip definition` | Trip with null endDate counts; trip with future endDate counts |
| `member trip counts` | Trip where user is group member counts toward limit |
| `followed trip excluded` | Trip followed (trip_followers) not counted |
| `traveler limit free` | Adding 7th traveler to trip blocks at 6 for free user |
| `traveler limit premium` | Premium allows up to 200 travelers |

#### `server/__tests__/itinerary-limits.test.ts` — Integration, pg-mem + supertest + OpenAI mock

| Test | Description |
|---|---|
| `generation allowed 1-5` | Free user can generate 5 times in a month |
| `generation blocked at 6` | Free user returns 429 on 6th attempt in same month |
| `monthly reset` | Pre-seeded counter for `2025-02`, generation in `2025-03` succeeds |
| `premium unlimited` | Premium user not blocked at 5 or 100 |
| `admin bypasses monthly` | Admin not blocked at any count |
| `feature flag off` | Returns 403 when `ai_itinerary_generation` flag is false |
| `idempotency key reuse` | Same idempotency key returns previous result, usage not double-counted |
| `concurrent at limit` | Two simultaneous requests at count=4 for limit=5: exactly one of them hits 429 |
| `token counting` | Successful generation increments `openai_tokens_total` counter |
| `failed generation no count` | Mocked OpenAI failure does not increment generation counter |

#### `server/__tests__/admin-routes.test.ts` — Integration, pg-mem + supertest

| Test | Description |
|---|---|
| `auth required` | All admin routes return 401 without token |
| `admin role required` | All admin routes return 403 with non-admin token |
| `list users` | GET /api/admin/users returns paginated list |
| `search users` | ?search=email filters correctly |
| `change tier` | PATCH /api/admin/users/:id/tier writes user_tiers + audit_log |
| `change tier reason required` | Returns 400 when reason missing |
| `change role` | PATCH /api/admin/users/:id/role writes users.role + audit_log |
| `toggle flag` | PATCH /api/admin/features/:key/flag updates feature_flags + audit_log |
| `update tier limit` | PATCH /api/admin/tiers/:key/limits/:key upserts tier_limits + audit_log |
| `user data window 7d` | Returns correct counts filtered to last 7 days |
| `user data window all-time` | Returns lifetime counts |
| `audit log paginated` | GET /api/admin/audit-log returns paginated results |
| `audit log filtered` | ?action=USER_TIER_CHANGED filters correctly |
| `cannot change own role` | Admin cannot revoke their own admin role (prevent lockout) |

#### `server/__tests__/usage-tracking.test.ts` — Integration, pg-mem

| Test | Description |
|---|---|
| `recordUsage increments` | Counter increments correctly |
| `recordUsage monthly window` | Uses correct `YYYY-MM` UTC window key |
| `recordUsage all-time` | Also increments `all-time` bucket |
| `window key UTC` | Window key is `2025-03` not `2025-02` at UTC month boundary |
| `multiple calls accumulate` | 3 calls = count of 3 |
| `getUsage correct` | Returns correct value for window |

#### `app/tests/entitlements.test.ts` — Unit, frontend

| Test | Description |
|---|---|
| `getLimit infinity` | Client helper returns `Infinity` when API returns `-1` |
| `canUseFeature false` | Returns false when API response shows feature disabled |
| `canUseFeature true` | Returns true when both flag and entitlement are true |

#### `app/e2e/tiers.test.ts` — Playwright E2E

| Test | Description |
|---|---|
| `free 4th trip blocked` | UI shows limit message; API returns 429 on 4th trip create |
| `premium 4th trip allowed` | Premium user creates 4+ trips successfully |
| `admin past trip` | Admin creates trip with end date yesterday — succeeds |
| `admin tab visible` | Admin sees admin tab in nav bar |
| `non-admin tab hidden` | Non-admin does not see admin tab |
| `admin user search` | Admin navigates to /admin/users and searches for a user |
| `admin tier change` | Admin changes a user's tier, sees confirmation |

---

## 8. Documentation Plan

### `docs/tiers.md`

- Tier model and rank-based inheritance
- Tier definitions table (limits, capabilities)
- Active trip definition with examples
- How a user's current tier is resolved
- How admin bypasses work (and which restrictions remain)
- How to add a new tier (schema + seed)
- How to change a user's tier (admin panel vs. direct DB)

### `docs/admin.md`

- Admin role: definition and capabilities
- Bootstrap process: named emails, case-insensitive match, idempotent
- Admin bypasses: list of what is and is not bypassed
- Admin API reference (`/api/admin/*`)
- Audit log: schema, recorded actions, how to query
- Admin UI: how to access, what each page does
- Security model: server-side RBAC, no client-only admin gates
- How to provision the first admin user in a new deployment

### `docs/feature-flags.md`

- Flags are deployment controls, not tier controls
- YAML is seed-only; DB is runtime truth
- How both checks (flag + tier) must pass
- Precedence rules (numbered, matching Section 6)
- Single-environment model rationale
- How to add a new feature
- How to toggle a flag at runtime (admin panel)
- Admin bypass: feature flags are NOT bypassed by admins

### Updated `docs/faq/testing-and-coverage.md`

Add new test files table with descriptions. Update total counts.

### Updated `docs/faq/api-usage.md`

Add `/api/entitlements/me` and `/api/admin/*` to API surface section.

### Updated `docs/faq/user-administration.md`

Add admin bootstrap, tier management, audit log sections.

### Updated `CLAUDE.md`

Add entitlement system section covering: the entitlement service contract, bypass rules,
feature flag vs. tier distinction, admin system, new config files.

---

## 9. Outstanding Clarifying Questions

**Q1 — AI generation counter: successful runs vs. attempts**

The spec says "max 5 successful runs per calendar month." The current plan increments the counter
**before** calling OpenAI (atomic check-and-increment) and does **not** roll back if the call
fails. This prevents circumventing the limit by deliberately triggering failures.

If the intent is strictly "5 completions that returned a result to the user," the counter should
increment **after** a successful OpenAI response, and the atomic pre-check would compare against
`current_count < limit` at the time of the attempt (non-atomic, races are possible under concurrent
load).

**Recommended default:** Increment before call (attempt-based). Easier to implement atomically
and prevents abuse. Please confirm.

**Q2 — Active trip membership: what counts as "accepted member"**

`group_members` rows have `claimed_at` (set when an invited user joins) and `removed_at`. There
is no explicit `status = 'accepted'` column. The proposed query counts rows where
`claimed_at IS NOT NULL AND removed_at IS NULL`.

Question: Should trips the user **created** (where they are `groups.owner_id`) also count even
if there is no `group_members` row for them? Owners are not always in the `group_members` table.

**Recommended default:** Count trips owned by any of the user's groups (`groups.owner_id = userId`)
OR trips where the user has a non-removed, claimed `group_members` row. Please confirm.

**Q3 — Token counting granularity for User Data page**

`api-limits.yaml` lists callers: `ITINERARY_PLAN_P0_NORM`, `P1_ROUTE`, `P2_DAYS`, `P3_VALIDATE`,
`P4_RENDER`. Should the user data table show one `openai_tokens_total` column, or one column
per caller (P0 tokens, P1 tokens, etc.)?

**Recommended default:** One `openai_tokens_total` column summed across all stages per generation,
plus a separate `ai_itinerary_generations` count column. Caller-level breakdown can be added later
if needed. Please confirm.

**Q4 — Admin cannot revoke own admin role**

To prevent accidental lockout, the plan includes a guard: admin cannot set their own
`role = 'user'`. A second admin must do it.

**Recommended default:** Yes, enforce this guard. Please confirm.

**Q5 — Audit log for logins**

The spec lists four audit actions: set tier, set admin, change tier limits, change feature flags.
Login events were not listed. Should login events be recorded (adds volume but useful for
security investigations)?

**Recommended default:** Do not record regular login events in `audit_log`. The bootstrap
grant is recorded. Login activity is already visible in `users.last_login_at` / `web_users.last_login_at`. Please confirm.

---

## 10. Recommended Defaults (confirmed from prior session, incorporated here)

| Decision | Default | Rationale |
|---|---|---|
| Monthly window key format | `YYYY-MM` in UTC via `new Date().toISOString().slice(0,7)` | Consistent, simple, matches spec |
| Atomic AI generation check | `UPDATE usage_counters SET count = count+1 WHERE ... AND count < $limit RETURNING count` | Single-statement atomic; no explicit transaction needed for Postgres row-level lock |
| Pro tier seed data | Explicit rows at same values as Premium | Prevents silent coupling |
| All features at Free tier | Yes — entitlement rows `is_allowed = true` for all tiers | Spec limits are numeric; no feature exclusions at Free |
| Feature flag scope | `'global'` only | Single-environment model |
| Past-date guard | `endDate < CURRENT_DATE` at UTC midnight | Spec says `endDate < nowUtc` |
| User data page cache | In-memory TTL cache (60s) keyed by `window+page` | Only on aggregate stats endpoint |
| Pagination defaults | `page=1, limit=50` | Matches conventional pagination |
| Admin email comparison | `email.trim().toLowerCase()` | Case-insensitive, whitespace-safe |
| Idempotency key | Optional client-supplied string in request body | Client controls retry semantics |
| Audit log retention | Indefinite | Simple; archival can be added later |
| Admin cannot revoke own role | Yes — guard in route handler | Prevents lockout |
| Reason minimum length | 3 characters | Prevents empty-string bypass |

---

## Appendix A: Entitlement Service Contract

```typescript
// server/src/services/entitlementService.ts

// Bootstrap
export const ensureAdminBootstrap: (userId: string, email: string) => Promise<void>

// Tier resolution
export const getUserTier: (userId: string) => Promise<Tier>
export const getUserRole: (userId: string) => Promise<UserRole>

// Feature checks (both must pass: flag AND tier)
export const isFeatureEnabled: (featureKey: string) => Promise<boolean>
export const canUseFeature: (userId: string, featureKey: string) => Promise<boolean>

// Limit checks
export const getLimit: (userId: string, limitKey: string) => Promise<number>  // Infinity if -1
export const checkLimit: (userId: string, limitKey: string, currentValue: number) => Promise<void>  // throws EntitlementLimitError

// Active trip counting
export const countActiveTrips: (userId: string) => Promise<number>

// Usage
export const recordUsage: (userId: string, metricKey: string, amount?: number, windowKey?: string) => Promise<void>
export const getUsage: (userId: string, metricKey: string, windowKey: string) => Promise<number>
export const atomicIncrementIfUnderLimit: (
  userId: string,
  metricKey: string,
  windowKey: string,
  limit: number
) => Promise<{ allowed: boolean; newCount: number }>

// Startup seeding
export const seedEntitlementDefaults: () => Promise<void>
```

### Tier inheritance algorithm

```
getLimit(userId, limitKey):
  1. Fetch user's current tier (with rank)
  2. SELECT limit_value FROM tier_limits tl
     JOIN tiers t ON t.id = tl.tier_id
     WHERE tl.limit_key = $limitKey
       AND t.rank <= userTier.rank
       AND t.is_active = true
     ORDER BY t.rank DESC
     LIMIT 1
  3. If no row found: return Infinity (unconfigured = unlimited)
  4. If limit_value = -1: return Infinity
  5. Return limit_value
```

This means Pro (rank=3) resolves limits by walking down: Pro row first, then Premium row,
then Free row. The highest matching rank wins (i.e., the most specific tier for the user).

---

## Appendix B: File Inventory Summary

### New server files

```
server/src/config/featureFlags.ts
server/src/errors.ts
server/src/middleware/requireAdmin.ts
server/src/routes/adminRoutes.ts
server/src/services/entitlementService.ts
server/src/services/usageService.ts
server/config/feature-flags.yaml
server/__tests__/admin-bootstrap.test.ts
server/__tests__/admin-routes.test.ts
server/__tests__/entitlements.test.ts
server/__tests__/itinerary-limits.test.ts
server/__tests__/tiers-limits.test.ts
server/__tests__/usage-tracking.test.ts
```

### Modified server files

```
server/src/apis/openaiApi.ts        (capture token counts)
server/src/apis/openaiCallers.ts    (thread token counts)
server/src/app.ts                   (mount admin router)
server/src/auth.ts                  (add role to TokenPayload, update createToken)
server/src/db.firebase.ts           (all new db functions)
server/src/db.postgres.ts           (schema + seed + new functions)
server/src/db.ts                    (new facade functions)
server/src/index.ts                 (call seedEntitlementDefaults)
server/src/routes/accountRoutes.ts  (traveler limit check)
server/src/routes/authRoutes.ts     (call ensureAdminBootstrap, pass role to createToken)
server/src/routes/itineraryRoutes.ts (flag + monthly limit + idempotency)
server/src/routes/tripRoutes.ts     (active trip limit + past-date guard)
server/src/routes/webAuthRoutes.ts  (call ensureAdminBootstrap, pass role to createToken)
server/src/services/itineraryPromptPlanService.ts (return tokensUsed)
server/src/types.ts                 (new types + role on User)
server/__tests__/helpers.ts         (makeAdminUser, setUserTier)
server/__tests__/pg-mem-setup.ts    (add new tables to teardown)
```

### New frontend files

```
app/tabs/AdminTab.tsx
app/tabs/AdminUsersTab.tsx
app/tabs/AdminTiersTab.tsx
app/tabs/AdminFeaturesTab.tsx
app/tabs/AdminUserDataTab.tsx
app/utils/entitlements.ts
app/tests/entitlements.test.ts
app/e2e/tiers.test.ts
```

### Modified frontend files

```
app/App.tsx         (admin page types, userRole state, admin tab in nav)
app/utils/session.ts (role in StoredSession)
```

### New docs

```
docs/tiers.md
docs/admin.md
docs/feature-flags.md
```

### Updated docs

```
docs/faq/testing-and-coverage.md
docs/faq/api-usage.md
docs/faq/user-administration.md
CLAUDE.md
```
