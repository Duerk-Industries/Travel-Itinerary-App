# Trip Blog Social & Recap Layer — Architecture

**Status:** Design of record for the work described in `docs/trip-blog-social-prd.md`.
Nothing in this document is implemented yet.

**Relationship to existing documents.** `docs/travel-blog-architecture.md` is the design of record
for the blog *platform* — items, days, media pipeline, storage ledger, publication consent, public
pages. This document layers on top of it and does not restate it. Where the two disagree about
anything already built, the older document wins; where this one specifies new tables, routes or
flags, it is authoritative.

**Reuse rule.** Every "reuse `X`" below names a file that exists in this repo today. Read it before
writing anything new. This layer is deliberately built out of parts that already work rather than
new subsystems: no new transport, no new storage backend, no new auth model, no new job queue.

---

## 1. Design position

Three constraints shape every decision here.

**The blog already has an audience model, and this layer must inherit it rather than invent one.**
`blog_items.audience` is `travelers | followers | public`, publication requires unanimous adult
consent, and any single traveler can revoke it unilaterally. A social layer that ignored that model
would let a comment leak content the consent vote was designed to gate. So: **a comment or reaction
inherits the effective audience of its target at creation time and is filtered by the same
projection logic that filters items.**

**Read latency is the thing most likely to be damaged.** `GET /:tripId/blog` already does a lot:
blog fetch, media list, per-asset signed URL minting, gallery grouping, cover resolution. Adding
per-target aggregate queries for reactions and comments would push it over. So: **counts are
denormalized onto counter rows, updated transactionally with the write, and read as a single batched
lookup per page.** Aggregates are never computed in a read path.

**Moderation is a launch requirement, not a follow-up.** The product publishes to a public URL and
already has an abuse mailbox and a trip-owner review gate. Comments without a report path and an
owner hide would be a regression in a system that currently has no user-generated third-party text
at all.

### What is deliberately *not* built

| Not building | Why |
|---|---|
| Anonymous public commenting | PR-1. No moderation staffing model; puts unmoderated third-party text on a page travelers unanimously consented to publish. |
| A generic reactions service across all entity types | The blog's audience model is specific. `itineraryReactionService.ts` stays separate; we copy its *shape*, not its storage. |
| Deep comment nesting | Two levels covers the observed conversation pattern and keeps pagination and the tombstone rule tractable. |
| A new notification subsystem | There is none today. Mentions and nudges dispatch through the existing `smtpCallers.ts` plus socket events; a push/in-app inbox is a separate program. |
| Rich text or media in comments | NFR-8. Plain text is the only input that cannot become an XSS vector on the public page. |
| A separate realtime channel | The Socket.IO trip room (`trip:${tripId}`) already exists, is already authorized against trip membership, and already carries presence. |

---

## 2. Component map

```
                    ┌──────────────────────────────────────────────┐
  app/tabs/         │  tripBlog.tsx  (existing, heavily extended)  │
                    └───────────┬──────────────────┬───────────────┘
                                │                  │
        ┌───────────────────────┴──────┐    ┌──────┴────────────────────────┐
        │ NEW app/components/blog/     │    │ EXISTING (extended)           │
        │  BlogReactionBar.tsx         │    │  DayMediaGallery.tsx          │
        │  BlogCommentThread.tsx       │    │  DayMediaLightbox.tsx         │
        │  BlogCommentComposer.tsx     │    │  BlogRichTextEditor.tsx       │
        │  DayFactStrip.tsx            │    │  TripDayMap.tsx               │
        │  DayTimelineRail.tsx         │    │  PresenceAvatars.tsx          │
        │  DayStarterCard.tsx          │    │  ReactionBar.tsx (pattern)    │
        │  PhotoFirstComposer.tsx      │    └───────────────────────────────┘
        │  ContributorStrip.tsx        │
        │  TripRecapCards.tsx          │
        └───────────┬──────────────────┘
                    │  REST (app/utils/apiClient.ts)   │ Socket.IO (app/utils/socket.ts)
        ────────────┼──────────────────────────────────┼──────────────────────────
                    ▼                                  ▼
   server/src/routes/                          server/src/socket/
     blogEngagementRoutes.ts   NEW               blogEngagementHandler.ts   NEW
     blogInsightRoutes.ts      NEW               index.ts                   extended
     blogAuthoringRoutes.ts    NEW
     blogRoutes.ts             extended
                    │
                    ▼
   server/src/services/
     blogEngagementService.ts   NEW   reactions, comments, counters, authz
     blogModerationService.ts   NEW   report, hide, strike count
     blogDayStarterService.ts   NEW   draft assembly (A1)
     blogDayFactsService.ts     NEW   fact strip + timeline + distance (C1/C3)
     blogRecapService.ts        NEW   trip recap aggregation (C7)
     blogMediaGroupingService.ts NEW  captured_at → day bucketing (A2)
                    │
                    ▼
   server/src/blog/
     engagementRepository.ts    NEW   interface + provider selection
     postgresEngagementRepository.ts  NEW
     firebaseEngagementRepository.ts  NEW
```

The routing split follows the existing convention of one route file per concern (`blogRoutes`,
`blogPublicationRoutes`, `blogImportRoutes`, …) rather than growing `blogRoutes.ts`, which is already
392 lines and carries the media-URL and gallery-grouping logic.

---

## 3. Data model

All new tables follow the existing blog migration conventions: `uuid_generate_v4()` defaults,
`ON DELETE CASCADE` from `trips`, `_at TIMESTAMP` naming, `CHECK` constraints on enum-ish text
columns. Migration filenames follow `YYYYMMDD_add_*.sql` with a matching `.rollback.sql` where the
change is not purely additive, matching `20260808_add_blog_day_cover.sql`.

### 3.1 Polymorphic target

Reactions and comments both attach to one of three things: a day, an item, or a media asset. Rather
than three parallel table sets, one nullable-column target is used with a check constraint enforcing
exactly one:

```sql
-- shared shape, repeated in both tables below
  target_kind   TEXT NOT NULL CHECK (target_kind IN ('day','item','asset')),
  blog_day_id   UUID REFERENCES blog_days(id) ON DELETE CASCADE,
  blog_item_id  UUID REFERENCES blog_items(id) ON DELETE CASCADE,
  asset_id      UUID REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  CHECK (
    (target_kind = 'day'   AND blog_day_id  IS NOT NULL AND blog_item_id IS NULL AND asset_id IS NULL) OR
    (target_kind = 'item'  AND blog_item_id IS NOT NULL AND blog_day_id  IS NULL AND asset_id IS NULL) OR
    (target_kind = 'asset' AND asset_id     IS NOT NULL AND blog_day_id  IS NULL AND blog_item_id IS NULL)
  )
```

Real FK columns are used rather than a `(target_kind, target_id)` string pair specifically so that
cascade-on-delete is enforced by the database. When a gallery item or an asset is deleted, its
engagement goes with it, with no application code to forget. This matters because the media pipeline
already deletes assets from several places (grace-expiry retention, per-asset delete, whole-item
delete).

### 3.2 `20260901_add_blog_engagement.sql`

```sql
CREATE TABLE IF NOT EXISTS blog_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('day','item','asset')),
  blog_day_id UUID REFERENCES blog_days(id) ON DELETE CASCADE,
  blog_item_id UUID REFERENCES blog_items(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('heart','laugh','wow','fire','clap','thanks')),
  audience TEXT NOT NULL DEFAULT 'travelers' CHECK (audience IN ('travelers','followers','public')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (/* exactly-one-target, as above */)
);

-- One reaction per user per target. Partial unique indexes, one per kind, because the
-- target columns are nullable and a plain composite unique would allow duplicates on NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_reactions_day   ON blog_reactions(blog_day_id,  user_id) WHERE blog_day_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_reactions_item  ON blog_reactions(blog_item_id, user_id) WHERE blog_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_reactions_asset ON blog_reactions(asset_id,     user_id) WHERE asset_id     IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blog_reactions_trip ON blog_reactions(trip_id, created_at);

CREATE TABLE IF NOT EXISTS blog_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('day','item','asset')),
  blog_day_id UUID REFERENCES blog_days(id) ON DELETE CASCADE,
  blog_item_id UUID REFERENCES blog_items(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES blog_comments(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL CHECK (author_role IN ('traveler','follower')),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  audience TEXT NOT NULL DEFAULT 'travelers' CHECK (audience IN ('travelers','followers','public')),
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP,
  hidden_at TIMESTAMP,
  hidden_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (/* exactly-one-target, as above */)
);
CREATE INDEX IF NOT EXISTS idx_blog_comments_day    ON blog_comments(blog_day_id, created_at)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_blog_comments_parent ON blog_comments(parent_comment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_blog_comments_trip   ON blog_comments(trip_id, created_at);

-- Denormalized counters. One row per target; the source of truth for every count the
-- read path renders. NFR-1 depends on this table existing.
CREATE TABLE IF NOT EXISTS blog_engagement_counters (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('day','item','asset')),
  target_id UUID NOT NULL,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  reaction_counts JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"heart":6,"laugh":2}
  reaction_total INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_blog_counters_trip ON blog_engagement_counters(trip_id);

CREATE TABLE IF NOT EXISTS blog_comment_mentions (
  comment_id UUID NOT NULL REFERENCES blog_comments(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at TIMESTAMP,
  PRIMARY KEY (comment_id, mentioned_user_id)
);

CREATE TABLE IF NOT EXISTS blog_comment_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comment_id UUID NOT NULL REFERENCES blog_comments(id) ON DELETE CASCADE,
  reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam','harassment','private_info','other')),
  detail TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','actioned','dismissed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  UNIQUE (comment_id, reporter_user_id)
);
```

`blog_engagement_counters.target_id` is intentionally **not** a foreign key — it is polymorphic
across three parents, and a counter row is disposable derived data. Orphan counter rows are cleaned
by the same nightly job that already runs storage reconciliation
(`blogStorageReconciliationService.ts`), not by cascade.

`author_role` is snapshotted on the comment rather than resolved at read time. A follower can later
be promoted to a traveler or removed from the trip entirely; the comment should keep rendering with
the role it was written under, and the read path should not need a membership join per comment.

### 3.3 `20260901_add_blog_authoring.sql`

```sql
-- A1: per-user, per-day dismissal of the Day Starter suggestion (FR-A1.3).
CREATE TABLE IF NOT EXISTS blog_day_starter_dismissals (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, local_date, user_id)
);

-- PR-3: photo geotags are off per trip until a traveler turns them on.
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS photo_location_enabled BOOLEAN NOT NULL DEFAULT FALSE;
-- Owner kill-switch for follower commenting (PRD open question 1).
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS follower_comments_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- C2: geotags captured from EXIF at upload. Nullable — most photos will not have them,
-- and the columns must be absent from every public projection.
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS captured_lat NUMERIC;
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS captured_lng NUMERIC;

-- B11.3: three hides on a trip ends commenting there for that user.
CREATE TABLE IF NOT EXISTS blog_comment_strikes (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strike_count INTEGER NOT NULL DEFAULT 0,
  blocked_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, user_id)
);
```

`captured_lat` / `captured_lng` are added to the *existing* asset table rather than a side table
because they are a property of the asset and the media pipeline already writes `captured_at` and
`capture_timezone` in the same place. The extraction happens in `blogMediaProcessingService.ts`
where EXIF is already parsed; the `photo_location_enabled` flag gates whether they are *read*, not
whether they are stored, so a trip can turn the map on retroactively without re-uploading.

### 3.4 pg-mem compatibility

The `memory` adapter runs on pg-mem, which the project memory records as lacking `NOT EXISTS`
subqueries and `ANY($1::uuid[])`, and as not supporting `ON CONFLICT DO NOTHING` with
`INSERT … SELECT`. Three consequences for this schema:

- Counter upserts must be written as `ON CONFLICT (target_kind, target_id) DO UPDATE` on a plain
  `INSERT … VALUES`, never `INSERT … SELECT`.
- Batched counter reads use `IN (…)` with expanded placeholders, not array parameters.
- The multi-column `CHECK` with `OR` branches is accepted by pg-mem, but the partial unique indexes
  must be verified early — if pg-mem rejects `WHERE` on a unique index, the memory adapter falls back
  to enforcing single-reaction-per-target in `postgresEngagementRepository`'s upsert path, which it
  does anyway via `ON CONFLICT`.

The memory adapter spreads `...postgresAdapter`, so new functions are inherited automatically; only
queries that pg-mem rejects need adapter-specific handling.

---

## 4. Authorization model

This is the part most likely to leak, so it is specified as a table rather than prose. `V` = may
view, `C` = may create, `E` = may edit own, `D` = may delete own, `H` = may hide others'.

| Actor | Blog items | Reactions | Comments | Covers | Publication |
|---|---|---|---|---|---|
| Traveler (trip member) | V C E D | V C | V C E D | set | request/consent/revoke |
| Trip owner | V C E D | V C | V C E D **H** | set | as above |
| Follower (`trip_followers`) | V | V C | V C E D | — | — |
| Admin (`role='admin'`) | V | V | V **H** | — | — |
| Unauthenticated public | V (public audience only) | counts only | V (public audience only) | — | — |

Resolution order for every engagement write, in `blogEngagementService`:

1. **Feature flag** — `isFeatureEnabled('trip_blog_reactions' | 'trip_blog_comments')`. No admin
   bypass, per the existing entitlement convention in `entitlementService.ts`.
2. **Actor role** — `ensureUserInTrip(tripId, userId)` for travelers; a new
   `ensureUserFollowsTrip(tripId, userId)` reading `trip_followers` for followers. A user who is
   neither gets `403`.
3. **Target reachability** — the target must exist, not be soft-deleted, and be visible to this actor
   under the same projection the read path applies. A follower cannot react to a `travelers`-audience
   item, and attempting it returns `404`, not `403`, so the endpoint does not confirm the item exists.
4. **Trip-level toggles** — `follower_comments_enabled` for follower comment creation.
5. **Strike block** — `blog_comment_strikes.blocked_at` for comment creation.
6. **Rate limit** — `httpRateLimitService.ts`, keyed per NFR-5.

Step 3 is the load-bearing one. It is implemented as a single function,
`resolveEngagementTarget(actor, tripId, targetKind, targetId)`, returning
`{ dayId, effectiveAudience } | null`, and **every** engagement route calls it. There is no second
path to a target.

### 4.1 Audience inheritance

A new reaction or comment gets `audience = effectiveAudience of its target at creation`. Concretely:

- Comment on a `public` item on a published blog → `public`. Visible on the public page.
- Comment on the same item while the blog is `private` → `travelers`. **Stays** `travelers` after the
  blog is later published (PR-2). Publishing does not rewrite existing comment audiences.
- Comment on a `followers` item → `followers`. Never public.

This is the mechanism that satisfies PR-2 without a second consent vote. It has one visible
consequence worth stating plainly: a thread written before publication and one written after can sit
on the same item with different public visibility. The UI marks non-public comments with a small
"visible to travelers" chip so this is never a surprise.

### 4.2 Revocation

`POST /blog/publication/revoke` already flips `visibility_state` and bumps `visibility_epoch`. Public
projection reads that state, so revocation hides engagement in the same operation with no extra work
(PR-4) — provided the public read path filters engagement through the same `isBlogPublic` gate it
already applies to items. This is asserted by a test, not by convention.

---

## 5. API surface

All routes mount under the existing `/api/trips` prefix in `server/src/app.ts`, matching the other
blog route groups. All authenticated routes use the existing `authenticate` middleware.

### 5.1 `blogEngagementRoutes.ts`

| Method | Path | Notes |
|---|---|---|
| `PUT` | `/:tripId/blog/:targetKind/:targetId/reactions` | Body `{ emoji }`. Idempotent upsert; re-sending the same emoji clears it (FR-B1.2). Returns the full summary. |
| `DELETE` | `/:tripId/blog/:targetKind/:targetId/reactions` | Explicit clear. |
| `GET` | `/:tripId/blog/:targetKind/:targetId/reactions` | Reactor list, paginated. Only called when a user expands the summary — never on page load. |
| `GET` | `/:tripId/blog/comments` | `?dayDate=&cursor=&limit=`. Returns top-level comments for a whole day's targets in one call, each with up to 3 preview replies and a `replyCount`. |
| `GET` | `/:tripId/blog/comments/:commentId/replies` | `?cursor=&limit=` |
| `POST` | `/:tripId/blog/:targetKind/:targetId/comments` | Body `{ body, parentCommentId?, mentions? }`. `Idempotency-Key` required, matching the convention in `blogSocialRoutes.ts`. |
| `PATCH` | `/:tripId/blog/comments/:commentId` | 15-minute window (FR-B2.3). |
| `DELETE` | `/:tripId/blog/comments/:commentId` | Soft delete. |
| `POST` | `/:tripId/blog/comments/:commentId/report` | Body `{ reason, detail? }`. |
| `POST` | `/:tripId/blog/comments/:commentId/hide` | Owner/admin only. Writes `audit_log`. |
| `GET` | `/:tripId/blog/mentionable` | `?q=` — trip-scoped autocomplete (FR-B3.1, PR-7). |

The day-level comment fetch is the important shape decision: **one request per day, not one per
target.** A day with 23 photos, 3 text items and a day-level thread must not produce 27 requests.

### 5.2 `blogInsightRoutes.ts`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/:tripId/blog/days/:dayDate/facts` | Fact strip + timeline entries + map points (C1/C2/C3/C5). |
| `GET` | `/:tripId/blog/recap` | Trip recap (C7). Cached; see §7. |
| `GET` | `/:tripId/blog/places` | Places index (C6). |

Facts are a **separate request from the blog document**, not folded into `GET /:tripId/blog`. They
draw on transfers, lodgings, activities, car rentals and expenses — five more table reads — and they
are not needed for first paint. The day card renders headline, entries and gallery immediately and
fills the fact strip and map in as they arrive. This is what keeps NFR-1 achievable.

### 5.3 `blogAuthoringRoutes.ts`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/:tripId/blog/days/:dayDate/starter` | Returns `{ draft, sources[] }` or `204` if dismissed or the day already has text (A1). |
| `POST` | `/:tripId/blog/days/:dayDate/starter/accept` | Creates the `core.text` item authored to the caller. |
| `POST` | `/:tripId/blog/days/:dayDate/starter/dismiss` | Writes `blog_day_starter_dismissals`. |
| `PATCH` | `/:tripId/blog/days/:dayDate` | `{ headline?, summary? }` (A3). |
| `PATCH` | `/:tripId/blog` | `{ title?, subtitle?, introduction? }` (A4). |
| `POST` | `/:tripId/blog/media/group` | Body: candidate `[{ clientId, capturedAt }]`. Returns proposed day buckets (A2). Pure computation, no writes. |
| `POST` | `/:tripId/blog/media/:assetId/suggest-caption` | A8. Behind its own flag and its own `reserveApiUsageOrThrow` caller key. |

`POST /blog/media/group` is stateless on purpose: the client sends the timestamps it read locally
from the picker, the server answers with buckets using trip dates and timezone, and nothing is
uploaded until the user confirms. That keeps the "147 photos selected" preview instant and avoids
reserving storage for a batch the user may cancel.

### 5.4 Response shape additions to `GET /:tripId/blog`

Two additive fields, both from the counters table in one batched read:

```jsonc
{
  "days": [{
    "id": "…", "localDate": "2026-05-14",
    "headline": "Lost in Trastevere",          // already in the DB, now actually used
    "engagement": { "reactionCounts": {"heart": 4}, "reactionTotal": 4,
                    "commentCount": 3, "userReaction": "heart" },
    "contributors": [{ "userId": "…", "displayName": "Maya", "itemCount": 4, "assetCount": 19 }],
    "items": [{ "…": "…", "engagement": { /* same shape */ } }]
  }]
}
```

No existing field changes shape or meaning. Clients that ignore `engagement` behave exactly as today,
which matters because the mobile app ships on its own release cadence.

---

## 6. Realtime

Reuses the Socket.IO trip room established in `server/src/socket/`. `chatHandler.ts` already
authorizes `JOIN_TRIP` against trip membership before `socket.join(\`trip:${tripId}\`)`, so a client
that has joined for chat is already authorized for blog engagement in the same room.

New constants in `packages/messaging` alongside `CLIENT_EVENTS` / `SERVER_EVENTS`:

```ts
// Server → Client
BLOG_REACTION_UPDATED: 'blog:reaction_updated',   // { targetKind, targetId, counts, total }
BLOG_COMMENT_CREATED:  'blog:comment_created',    // full comment payload
BLOG_COMMENT_UPDATED:  'blog:comment_updated',    // edit or soft-delete or hide
BLOG_DAY_UPDATED:      'blog:day_updated',        // headline/summary/cover changed
// Client → Server
BLOG_TYPING:           'blog:typing',             // { dayDate } — B9, drives presence copy
```

Three rules keep this from becoming a leak:

1. **Reaction events carry counts only, never reactor identity.** Identity requires the explicit
   `GET …/reactions` call, which applies the full authorization chain.
2. **Comment events are filtered per socket by audience** before emit. A `travelers`-audience comment
   is emitted to sockets whose user is a trip member; a `followers` one also reaches follower
   sockets. This requires the socket to carry the user's role for the joined trip — `authMiddleware.ts`
   already resolves the user, so the room join is extended to cache `{ role }` on the socket.
3. **Realtime is never the write path.** Every mutation is a REST call; sockets only broadcast the
   result. A dropped socket costs freshness, never data (FR-B4.2).

The existing single-instance caveat carries over unchanged: presence and broadcast are in-process,
with no Redis adapter, so this remains single-instance until that is addressed for chat.

---

## 7. Insight computation

### 7.1 Day facts

`blogDayFactsService.ts` assembles, for one trip-day:

| Fact | Source | Method |
|---|---|---|
| Weather | existing `blog_days` enrichment | unchanged |
| Distance | transfers + geocoded activity/lodging points | Straight-line haversine between consecutive points, labelled "approx." (PRD Q4). No Directions API call. |
| Places | activities, lodgings, car rentals with a resolved place | Distinct by place ref |
| Spend | `expenses` where `expense_date = localDate` | `amount_in_trip_currency` when present, else `exchangeRates.ts`. Audience `travelers`. |
| Photo/video counts, time span | `blog_media_assets.captured_at` | min/max, count by `media_kind_key` |
| Planned vs. actual | activity `status` | `Completed` / `Cancelled` against the lifecycle in `utils/itineraryStatus.ts` |

The timeline rail (C3) is the same data emitted as a sorted list rather than aggregates, so it is one
service and one query set producing two projections.

Facts are computed per request and cached in-process for `tripBlog.factsCacheTtlMs`. They are not
persisted: every input is already persisted elsewhere, and a stale materialized fact strip that
disagrees with the expenses tab would be worse than a slightly slower request.

### 7.2 Trip recap

`blogRecapService.ts` aggregates across the whole trip: day count, total distance, distinct places,
media counts, per-contributor counts, top-reacted asset, most-commented day. This is genuinely
expensive, so it is computed on demand and cached with a longer TTL, keyed on
`(tripId, contentRevision, engagementRevision)`. `trip_blogs.content_revision` already exists and
already increments on content change; an `engagement_revision` column is added by the same migration
and bumped on engagement writes, so the cache key invalidates correctly without a scan.

---

## 8. Day Starter assembly (A1)

`blogDayStarterService.ts` is a **deterministic template**, not an LLM call, in v1:

```
sources = { transfers, activities, lodgings, carRentals, mediaCluster, weather }
if (nothing but media)      → "N photos from {weekday}" + place names from geotags, if enabled
if (itinerary data present) → sentence per source group, ordered by time, joined
```

It reuses `buildNarrativeBlogBody` from `server/src/blog/narrative.ts` for phrasing and the same data
`syncItineraryToBlog` already reads. Choosing a template over generation is deliberate: it is free,
instant, offline-safe, gives identical output for identical inputs (which makes it testable), and
cannot hallucinate a restaurant the group never went to. The "Rewrite" button in the UI is where an
LLM call belongs — an explicit, user-initiated, rate-limited action behind
`trip_blog_ai_highlights`, which is already a registered flag with an unused item kind
(`core.ai_highlight`) waiting for it.

A starter is never persisted before acceptance (FR-A1.2). On acceptance it becomes an ordinary
`core.text` item through the existing `createBlogTextItem` path, with `source_type = 'day_starter'`
recorded on the item so acceptance rate is measurable — the stage-2 rollout gate depends on that
number existing.

---

## 9. Configuration

### 9.1 Feature flags (`server/config/feature-flags.yaml`)

All default `false`, following the existing blog flags:

| Flag | Gates |
|---|---|
| `trip_blog_reactions` | B1, B7 |
| `trip_blog_comments` | B2, B11 |
| `trip_blog_mentions` | B3 |
| `trip_blog_realtime` | B4, B9 |
| `trip_blog_day_starter` | A1, A6 |
| `trip_blog_photo_composer` | A2 |
| `trip_blog_day_facts` | C1, C2, C3, C5 |
| `trip_blog_spend_summary` | C4 |
| `trip_blog_recap` | C7, B10 |
| `trip_blog_caption_ai` | A8, A9 transcription |
| `trip_blog_nudges` | B6 |

`trip_blog_comments` implies moderation: `blogModerationService` is not separately flagged, because
shipping comments without it is not a configuration we want to be reachable.

The existing fail-open convention (a missing flag row means allowed) is a real hazard for comments
specifically — a schema gap would open commenting rather than close it. Mitigation: the comment
routes additionally require `follower_comments_enabled` for follower authors and the strike check for
everyone, neither of which is fail-open, so a missing flag row cannot on its own produce an
unmoderated surface.

### 9.2 Limits (`server/config/api-limits.yaml`, under `tripBlog`)

```yaml
  commentMaxLength: 2000
  commentsPerMinutePerUser: 10
  reactionsPerMinutePerUser: 60
  commentPageSize: 20
  replyPreviewCount: 3
  mentionsPerComment: 10
  commentEditWindowSeconds: 900
  hideStrikesBeforeBlock: 3
  factsCacheTtlMs: 60000
  recapCacheTtlMs: 3600000
  captionSuggestionsPerDayPerUser: 50
  starterRewritesPerDayPerUser: 10
```

### 9.3 Cost model

`captionSuggestionsPerDayPerUser` and `starterRewritesPerDayPerUser` are the only entries here with a
per-call external cost. Both route through `reserveApiUsageOrThrow` with new caller keys
(`BLOG_CAPTION_SUGGEST`, `BLOG_STARTER_REWRITE`) and need corresponding entries in
`server/config/cost-model.yaml` before the flags go on anywhere but internal trips. PRD open
question 2 (Premium-only?) must be answered before stage 5.

---

## 10. Failure modes

| Failure | Behaviour |
|---|---|
| Counter row drifts from source rows | Reads stay fast and slightly wrong. Nightly reconciliation recomputes counters for trips with engagement writes in the last 24h, reusing the `blogStorageReconciliationService` scheduling pattern. |
| Socket unavailable | REST unaffected. Client shows a "Reconnecting…" chip on the composer only, and refetches on reconnect. |
| Facts request fails | Day card renders without the fact strip and map. No error surfaced — a missing fact strip is indistinguishable from a day with no derivable facts, by design (FR-C1.1). |
| Recap generation times out | `202` + retry-after; UI shows a generating state. Never blocks the blog. |
| Caption AI unavailable | Suggest button disabled with a quiet tooltip. Uploads unaffected. |
| pg-mem rejects a query | Caught by CI, since the memory adapter is what the test suite runs against. This is why the adapter matrix is NFR-2 rather than a nice-to-have. |
| Comment on an asset that is grace-hidden | Target resolution fails → `404`. Grace-hidden assets are already absent from `items`; engagement must not resurrect them. |

---

## 11. Testing strategy

- **Authorization matrix (§4)** — a table-driven test over {traveler, owner, follower, admin,
  stranger, anonymous} × {day, item, asset} × {view, react, comment, edit, delete, hide} asserting
  the exact status code. This is the highest-value test in the program; write it before the routes.
- **Audience inheritance (§4.1)** — comment created private stays private after publication;
  comment created public disappears on revoke.
- **Counter consistency** — property test: N random reaction/comment/delete operations, then assert
  counters equal a recomputed aggregate.
- **Adapter parity (NFR-2)** — the engagement repository suite runs against all three providers.
- **Read-path performance (NFR-1)** — a benchmark test on a seeded trip with 14 days, 300 assets and
  500 comments, asserting a bounded query count for `GET /:tripId/blog`, not a wall-clock time.
- **Public projection** — a snapshot test asserting no reactor names, no comment author emails, no
  geotags and no `travelers`-audience content in the public payload.
- **Day Starter determinism** — fixed fixtures produce byte-identical drafts.
- **E2E (Playwright, `app/e2e/`)** — react → reload → reaction persists; comment → second browser as
  a follower sees it; owner hides it; it disappears for both.

---

## 12. Open architectural questions

1. **Counter storage on Firebase.** The Postgres design uses a counters table with transactional
   updates. Firestore's atomic increment gives the same guarantee more cheaply, but the two adapters
   would then differ in *mechanism*, not just SQL. Proposal: keep the interface identical
   (`incrementCounters(targetKind, targetId, delta)`) and let each adapter implement it natively.
2. **Single-instance realtime.** Blog engagement inherits chat's in-process presence limitation. If
   this ships before a Redis adapter, a horizontally scaled deployment silently drops cross-instance
   broadcasts. REST still works, so it degrades rather than breaks — but this should be an explicit
   accepted risk, not a discovery.
3. **Comment audience on audience change.** If a traveler changes an item's audience from `travelers`
   to `public` after comments exist, do existing comments move with it? Proposal: **no** — comments
   keep their creation-time audience, and the UI warns when changing the audience of an item that has
   non-matching comments. Needs a product decision.
4. **EXIF geotag extraction cost.** Adding lat/lng parsing to `blogMediaProcessingService.ts` touches
   the hot upload path. Needs a benchmark on the existing pipeline before C2 starts.
5. **Where nudges are dispatched from.** There is no notification service. B6 currently implies a
   scheduled job plus `smtpCallers.ts`. If an in-app inbox is coming, B6 should wait for it rather
   than build an email-only path that has to be unwound.
