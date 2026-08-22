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
new subsystems: no new transport, no new storage backend, and no new auth model. Recap work and
notification delivery use narrow DB-backed claim/outbox tables rather than another in-process queue or
a new queue vendor.

---

## 1. Design position

Three constraints shape every decision here.

**The blog already has an audience model, and this layer must inherit it rather than invent one.**
`blog_items.audience` is `travelers | followers | public`, publication requires unanimous adult
consent, and any single traveler can revoke it unilaterally. A social layer that ignored that model
would let a comment leak content the consent vote was designed to gate. So: **a comment or reaction
inherits the effective audience of its target at creation time and is filtered by the same
projection logic that filters items** — **[confirmed]**.

**Read latency is the thing most likely to be damaged.** `GET /:tripId/blog` already does a lot:
blog fetch, media list, per-asset signed URL minting, gallery grouping, cover resolution. Adding
  per-target aggregate queries for reactions and comments would push it over. So: **counts are
  denormalized by target *and audience*, updated transactionally with the write, and read as bounded
  batched lookups.** Aggregates are never computed in a read path. Audience is part of the counter key;
  otherwise a private reaction would leak into a public count.

**Moderation is a launch requirement, not a follow-up.** The product publishes to a public URL and
already has an abuse mailbox and a trip-owner review gate. Comments without a report path and an
owner hide would be a regression in a system that currently has no user-generated third-party text
at all.

Three positions in this document are marked **[confirmed]**: audience inheritance (above, mechanism
in §4.1), no anonymous public commenting (the table below), and the deterministic Day Starter (§8).
These are ratified product decisions, not open design choices — see `trip-blog-social-prd.md` §1a.
Treat them the way the constraints in `travel-blog-architecture.md`'s "Confirmed product decisions"
are treated: as inputs.

### What is deliberately *not* built

| Not building | Why |
|---|---|
| Anonymous public commenting **[confirmed]** | PR-1. No moderation staffing model; puts unmoderated third-party text on a page travelers unanimously consented to publish. |
| A generic reactions service across all entity types | The blog's audience model is specific. `itineraryReactionService.ts` stays separate; we copy its *shape*, not its storage. |
| Deep comment nesting | Two levels covers the observed conversation pattern and keeps pagination and the tombstone rule tractable. |
| ~~A new notification subsystem~~ | **Reversed — now in scope.** There is none today, and mentions (B3) and nudges (B6) both need one. Building an email-only stopgap would have to be unwound. Design in §13. |
| Rich text or media in comments | NFR-8. Plain text is the only input that cannot become an XSS vector on the public page. |
| A separate realtime transport | Socket.IO remains the transport. Blog subscriptions use audience-segmented rooms; followers must never join the traveler/chat room. |

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
     blogEngagementService.ts   NEW   reactions, comments, counters, authz, spam check
     blogModerationService.ts   NEW   report, hide, strike count, automated filtering
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

   server/src/socket/
     blogEngagementHandler.ts   NEW   BLOG_SUBSCRIBE + audience rooms

   server/src/services/
     notificationOutboxWorker.ts NEW  durable, leased provider delivery
```

The routing split follows the existing convention of one route file per concern (`blogRoutes`,
`blogPublicationRoutes`, `blogImportRoutes`, …) rather than growing `blogRoutes.ts`, which is already
392 lines and carries the media-URL and gallery-grouping logic.

The same rule applies to the client. `tripBlog.tsx` is already a stateful tab and must become a
composition shell, not absorb every new reducer and request. Fetch helpers remain owned by the tab
per repository convention, while focused hooks (`useBlogDocument`, `useBlogAutosave`,
`useBlogEngagement`, `useBlogInsights`) own cancellation, normalized target state and optimistic
reconciliation. Components receive capability booleans and typed view models, not raw auth/flag
objects. This makes flag combinations and traveler/follower/public rendering independently testable.

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
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('traveler','follower')),
  body TEXT,
  audience TEXT NOT NULL DEFAULT 'travelers' CHECK (audience IN ('travelers','followers','public')),
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP,
  hidden_at TIMESTAMP,
  hidden_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (/* exactly-one-target, as above */),
  CHECK ((deleted_at IS NULL AND char_length(body) BETWEEN 1 AND 2000) OR
         (deleted_at IS NOT NULL AND body IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_blog_comments_day    ON blog_comments(blog_day_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_blog_comments_parent ON blog_comments(parent_comment_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_blog_comments_trip   ON blog_comments(trip_id, created_at);

-- Denormalized counters. One row per target and creation-time audience; source of truth for counts the
-- read path renders. NFR-1 depends on this table existing.
CREATE TABLE IF NOT EXISTS blog_engagement_counters (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('day','item','asset')),
  target_id UUID NOT NULL,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('travelers','followers','public')),
  reaction_counts JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"heart":6,"laugh":2}
  reaction_total INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_kind, target_id, audience)
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
across three parents, and a counter row is disposable derived data. Orphan rows are cleaned by a
nightly reconciler using the storage-reconciliation pattern but claiming a unique DB-backed
`(job_key, window_start)` lease first. This new job must not deepen the duplicate-scheduler debt in
`horizontal-scaling-requirements.md` §3.3.

`author_role` is snapshotted on the comment rather than resolved at read time. A follower can later
be promoted to a traveler or removed from the trip entirely; the comment should keep rendering with
the role it was written under, and the read path should not need a membership join per comment.
`author_user_id` is nullable so account deletion can scrub the body and author link while preserving
a tombstone for replies (PR-6). The account-deletion transaction also deletes that user's reactions
and applies counter deltas before removing the user row; reconciliation is a safety net, not the
normal correctness path.

Counters are one row per `(target, audience)`, not merely per target. An authorized traveler sums all
audiences they may see; a follower sums `followers + public`; an anonymous reader receives `public`
only. The caller's own reaction is fetched in one separate batched identity query because it cannot be
derived from aggregate counters. Both queries are bounded by the page's target IDs.

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
-- Owner kill-switch for follower commenting (PRD §8 decision 1).
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS follower_comments_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- C2: geotags captured from EXIF at upload. Nullable — most photos will not have them,
-- and the columns must be absent from every public projection.
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS captured_lat NUMERIC;
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS captured_lng NUMERIC;
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS is_decorative BOOLEAN NOT NULL DEFAULT FALSE;

-- §4.05: optimistic concurrency for day headline/summary, matching the item autosave contract.
-- Without this column §4.05's 409 VERSION_CONFLICT contract cannot be honoured.
ALTER TABLE blog_days ADD COLUMN IF NOT EXISTS update_version INTEGER NOT NULL DEFAULT 1;

-- B11.3: three hides on a trip ends commenting there for that user.
CREATE TABLE IF NOT EXISTS blog_comment_strikes (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strike_count INTEGER NOT NULL DEFAULT 0,
  blocked_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, user_id)
);

-- C7: shared recap cache/lease; avoids duplicate cross-instance aggregation.
CREATE TABLE IF NOT EXISTS blog_recap_snapshots (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  content_revision INTEGER NOT NULL,
  engagement_revision INTEGER NOT NULL,
  audience_class TEXT NOT NULL CHECK (audience_class IN ('travelers','followers','public')),
  state TEXT NOT NULL CHECK (state IN ('pending','ready','failed')),
  payload JSONB,
  lease_owner TEXT,
  lease_expires_at TIMESTAMP,
  failure_code TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, content_revision, engagement_revision, audience_class)
);
```

`captured_lat` / `captured_lng` are added to the *existing* asset table rather than a side table
because they are a property of the asset, alongside the `captured_at` and `capture_timezone` columns
that are already there. `captured_at` is collected for grouping. Coordinates are extracted and sent
only when `photo_location_enabled` was explicitly enabled before selection; disabling stops future
collection and hides existing coordinates. Enabling is not retroactive. This is intentionally less
convenient than silently retaining location data for a future opt-in.

> **Capture metadata is client-supplied, and today nothing supplies it.** The server never parses
> EXIF. `blogMediaProcessingService.ts` uses sharp, which *strips* metadata on re-encode (only
> `.rotate()` consumes EXIF orientation, and it does so internally). `captured_at` is read from
> `req.body?.capturedAt` at `POST /blog/media/upload-init` — and `app/utils/blogUpload.ts` never
> sends that field, so **`captured_at` is NULL for every asset uploaded to date.**
>
> This is load-bearing for more than the map. The photo-first composer (A2) buckets by
> `captured_at`, and the fact strip's time-span chip (C1) reads it. Both are inert until the client
> populates it. Extraction is therefore **client-side**, following the path `capturedAt` was already
> designed for: `expo-image-picker` returns `exif` when `exif: true` is passed on native, and a
> small EXIF reader covers the web `File` path. `upload-init` gains `capturedAt`, `capturedLat`,
> `capturedLng` as optional body fields, validated server-side (ranges, not-in-the-future). The client
> omits lat/lng unless location sharing is enabled, and the server rejects supplied coordinates when
> the trip toggle is off; privacy cannot depend on a well-behaved client.
>
> Doing this client-side also preserves the settled no-server-EXIF decision: it adds **no server compute
> and no external API cost**, whereas parsing server-side would mean a `sharp().metadata()` pass per
> photo billed as Cloud Run CPU. See §12.4.

Backfilling `captured_at` for existing assets is not possible — sharp already discarded the metadata
before the rendition was written, and the originals are not retained. Existing assets keep a NULL
`captured_at` permanently and fall into the composer's "Unassigned" bucket (FR-A2.2), which is
exactly the case that requirement exists to handle.

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

### 3.5 Firebase representation

Firebase implements the same repository contract with server-only top-level collections, not client
SDK access: `blogReactions`, `blogComments`, `blogEngagementCounters`, `blogCommentMentions`,
`blogCommentReports`, `blogRecapSnapshots`, `notifications`, `notificationDevices`,
`notificationPreferences` and `notificationOutbox`. Document IDs are deterministic where SQL has a
unique key (for example, counter ID = hash of target kind/id/audience and reaction ID = hash of
target/user), which makes retries idempotent.

Each document denormalizes `tripId`, target IDs, audience and cursor fields needed by its bounded
query. Checked-in Firestore indexes cover `(tripId, dayDate, createdAt, id)`,
`(parentCommentId, createdAt, id)`, `(userId, readAt, createdAt)` and
`(state, nextAttemptAt, createdAt)`. Reaction/comment + audience counter +
`engagementRevision` updates share one Firestore transaction; outbox/recap claims use document
transactions with expiry. Firestore rules deny direct mobile/web reads and writes to these
collections—the Express authorization/projection service is the only path. Emulator rule/index and
transaction-contention tests are required alongside repository parity.

---

## 4. Authorization model

This is the part most likely to leak, so it is specified as a table rather than prose. `V` = may
view, `C` = may create, `E` = may edit own, `D` = may delete own, `H` = may hide others'.

| Actor | Blog items | Reactions | Comments | Covers | Publication |
|---|---|---|---|---|---|
| Traveler (trip member) | V C E D | V C | V C E D | set | request/consent/revoke |
| Trip owner | V C E D | V C | V C E D **H** | set | as above |
| Follower (`trip_followers`) | V | V C | V C E D | — | — |
| Admin (`role='admin'`) | — | — | reported context **H** | — | — |
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
4. **Automated Filtering** — For public comments, `blogEngagementService` invokes
   `blogModerationService.checkSpam(body)` before persistence. High-confidence spam is marked
   `hidden_at` immediately and logged as an automated strike.
5. **Trip-level toggles** — `follower_comments_enabled` for follower comment creation.
6. **Strike block** — `blog_comment_strikes.blocked_at` for comment creation.
7. **Actor/IP rate limit** — `httpRateLimitService.ts`, keyed per NFR-5.
8. **Aggregate reservation** — reserve the named `TRIP_BLOG_SOCIAL_API` and, for writes, storage
   operation units through `reserveApiUsageOrThrow` before repository work (§9.2).

Step 3 is the load-bearing one. It is implemented as a single function,
`resolveEngagementTarget(actor, tripId, targetKind, targetId)`, returning
`{ dayId, effectiveAudience } | null`, and **every** engagement route calls it. There is no second
path to a target.

**`resolveEngagementTarget` does not cover comment-id routes, and this is the gap most likely to
become an IDOR.** `PATCH`, `DELETE`, `report` and `hide` all take a *comment* id, not a target id, so
they bypass the function above entirely. They use a parallel, equally mandatory
`resolveComment(actor, tripId, commentId)` which verifies the comment belongs to `:tripId`, resolves
its target, applies the same visibility projection, and returns `404` — never `403` — when any check
fails. Two functions, no third path. See threat S3 in §15.1.

Admin access is deliberately narrower than trip-owner access. An admin does not acquire a general
right to browse a private blog. The moderation endpoint resolves a reported comment plus the minimum
thread context required to act, records the access/action in `audit_log`, and cannot be used to react,
comment, set covers or publish. **Context projection**: When an admin reviews a report, the context
(day/item) is projected without geotags or spend data, ensuring the reviewer sees only what is
necessary to judge the comment.

### 4.05 Day Metadata Concurrency
`blog_days.headline` and `summary` updates use an `update_version` integer. Every `PATCH` request
must include the current version. The server rejects the update with `409 VERSION_CONFLICT` if the
database version has moved, matching the Item autosave contract in §5.5.

### 4.1 Audience inheritance

A new reaction or comment gets `audience = effectiveAudience of its target at creation`. Concretely:

- Comment on a `public` item on a published blog → `public`. Visible on the public page.
- Comment on the same item while the blog is `private` → `travelers`. **Stays** `travelers` after the
  blog is later published (PR-2). Publishing does not rewrite existing comment audiences.
- Comment on a `followers` item → `followers`. Never public.
- An asset uses its parent blog item's audience; an asset can never widen its parent.
- A day-level target is `public` only while the blog is published. Before publication, a traveler
  creates `travelers` engagement; an authorized follower creates `followers` engagement. Both remain
  frozen even if publication later changes.

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
| `PUT` | `/:tripId/blog/:targetKind/:targetId/reactions` | Body `{ emoji }`. Idempotently sets/replaces the reaction. The client implements re-tap-to-clear by calling `DELETE`; replaying a `PUT` can never invert state. Returns the full summary. |
| `DELETE` | `/:tripId/blog/:targetKind/:targetId/reactions` | Explicit clear. |
| `GET` | `/:tripId/blog/:targetKind/:targetId/reactions` | Reactor list, paginated. Only called when a user expands the summary — never on page load. |
| `GET` | `/:tripId/blog/comments` | `?dayDate=&cursor=&limit=`. Returns top-level comments for a whole day's targets in one call, each with up to 3 preview replies and a `replyCount`. |
| `GET` | `/:tripId/blog/comments/:commentId/replies` | `?cursor=&limit=` |
| `POST` | `/:tripId/blog/:targetKind/:targetId/comments` | Body `{ body, parentCommentId?, mentions? }`. `Idempotency-Key` required, matching the convention in `blogSocialRoutes.ts`. |
| `PATCH` | `/:tripId/blog/comments/:commentId` | 15-minute window (FR-B2.3). |
| `DELETE` | `/:tripId/blog/comments/:commentId` | Soft delete. |
| `POST` | `/:tripId/blog/comments/:commentId/report` | Body `{ reason, detail? }`. |
| `POST` | `/:tripId/blog/comments/:commentId/hide` | Owner/admin only. Writes `audit_log`. |
| `DELETE` | `/:tripId/blog/comments/:commentId/hide` | Reverses one hide/strike idempotently; owner/admin only; audited. |
| `GET` | `/:tripId/blog/mentionable` | `?q=` — trip-scoped autocomplete (FR-B3.1, PR-7). |

The day-level comment fetch is the important shape decision: **one request per day, not one per
target.** A day with 23 photos, 3 text items and a day-level thread must not produce 27 requests.
All list cursors are opaque encodings of `(created_at, id)`, every `limit` is server-clamped, comment
bodies are capped by both 2,000 Unicode characters and 8 KiB UTF-8, and report detail is capped at
1,000 characters. Reply creation locks/resolves the parent and requires it to be a visible,
non-deleted top-level comment on the same trip and target. Client limits are usability hints; server
limits are the trust boundary.

Public engagement is not appended to the existing public blog document. A separate read-only route
under `publicBlogRoutes.ts` serves public-audience counters and paginated comments:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/public/blog/:username/:tripSlug/engagement` | `?dayDate=&cursor=&limit=`. Public-audience rows only; no reactor identity, coordinates, spend, email or private source metadata. Independently cached and IP-limited. |

Its ETag/cache key is `(tripId, visibilityEpoch, engagementRevision, dayDate, cursor)`. The public blog
document stays keyed on `contentRevision`; engagement changes therefore expire only the small social
payload and do not purge media or prose from the CDN (NFR-6). The endpoint uses
`max-age=15, stale-while-revalidate=45`; public engagement may be up to 60 seconds behind, while
revocation bypasses/purges immediately through `visibilityEpoch` and the existing publication path.

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

The cache key for facts includes the `content_revision` of the trip blog. Any change to activities,
transfers, or the blog meta (headline/summary) increments the revision, ensuring the fact strip
remains accurate without manual invalidation.

### 5.3 `blogAuthoringRoutes.ts`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/:tripId/blog/days/:dayDate/starter` | Returns `{ draft, sources[] }` or `204` if dismissed or the day already has text (A1). |
| `POST` | `/:tripId/blog/days/:dayDate/starter/accept` | Creates the `core.text` item authored to the caller. |
| `POST` | `/:tripId/blog/days/:dayDate/starter/dismiss` | Writes `blog_day_starter_dismissals`. |
| `PATCH` | `/:tripId/blog/days/:dayDate` | `{ headline?, summary? }` (A3). |
| `PATCH` | `/:tripId/blog` | `{ title?, subtitle?, introduction? }` (A4). |
| `POST` | `/:tripId/blog/media/group` | Body: at most 500 candidates `[{ clientId, capturedAt }]`. Returns proposed day buckets (A2). Pure computation, no writes. |
| `POST` | `/:tripId/blog/media/:assetId/suggest-caption` | A8. Behind its own flag and its own `reserveApiUsageOrThrow` caller key. |

`POST /blog/media/group` is stateless on purpose: the client sends the timestamps it read locally
from the picker, the server answers with buckets using trip dates and timezone, and nothing is
uploaded until the user confirms. That keeps the "147 photos selected" preview instant and avoids
reserving storage for a batch the user may cancel.

### 5.4 Response shape additions to `GET /:tripId/blog`

Additive fields assembled from: one audience-aware counter batch, one caller-reaction batch, and one
contributor batch for the returned target/day IDs. This is a fixed query count, not a query per item:

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

One existing read-path issue is fixed before these fields land: `blogRoutes.ts` currently calls
`listMedia()` for the whole trip and mints signed URLs with an unbounded `Promise.all`, even when the
blog response contains one page of days. The repository first resolves the returned day IDs, fetches
media for only those days, and signs only visible renditions through a configured concurrency pool.
Lightbox navigation fetches the next media cursor on demand. Adding engagement to the current
whole-trip fanout would make NFR-1 meaningless.

Likewise, the current route checks `If-None-Match` only after loading media and minting URLs. Split a
cheap revision/authorization lookup from payload assembly so a matching conditional request returns
`304` before media, counter, contributor or signing work. The ETag includes the audience class and
relevant flag generation plus an opaque keyed digest of the caller because `userReaction` differs by
user; it never exposes a raw user ID. One user's private projection must never validate another's cache.

### 5.5 Autosave conflict contract

The existing item `PATCH` returns `409 VERSION_CONFLICT` with the latest authorized
`{ version, body, updatedAt, lastEditor }`; it never logs either body. Resolution is explicit:

- **Keep mine** retries once against that exact latest version with
  `{ conflictResolution: 'replace' }` and an idempotency key. A second concurrent change produces a
  new conflict rather than an unbounded force-write.
- **Use theirs** adopts the returned server version, removes the persisted local draft only after the
  user confirms, and performs no write.
- **Show both** keeps the server item and creates one new adjacent `core.text` item from the local
  draft with an idempotency key; it does not concatenate HTML automatically.

All three preserve the scoped seven-day recovery draft until their terminal operation succeeds.

---

## 6. Realtime

Reuses Socket.IO as the transport but **does not admit followers to the existing
`trip:${tripId}` room**. That room carries traveler chat; allowing a follower to join it would leak
messages. A new `BLOG_SUBSCRIBE { tripId }` event authorizes either active trip membership or an
active follower relationship, then joins exactly one audience room:

```text
blog:<tripId>:travelers   active travelers only
blog:<tripId>:followers  active followers only
user:<userId>             authenticated user's notification events
```

`travelers` events emit only to the first room. `followers` and `public` events emit to both blog
rooms. The server rechecks authorization on subscribe/reconnect; trip removal or unfollow causes an
immediate room leave through the same revocation path that updates membership.

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
2. **Comment events are routed by audience**, using the segmented rooms above. No blog event is
   emitted to the traveler/chat room and no follower socket ever joins it.
3. **Realtime is never the write path.** Every mutation is a REST call; sockets only broadcast the
   result. A dropped socket costs freshness, never data (FR-B4.2).

The existing single-instance caveat carries over unchanged: rooms and broadcasts are in-process,
with no Redis adapter, so this remains single-instance until the realtime P0 items in
`horizontal-scaling-requirements.md` are closed. REST and durable notification rows remain correct.

---

## 7. Insight computation

### 7.1 Day facts

`blogDayFactsService.ts` assembles, for one trip-day:

| Fact | Source | Method |
|---|---|---|
| Weather | existing `blog_days` enrichment | unchanged |
| Distance | transfers + geocoded activity/lodging points | Straight-line haversine between consecutive points, labelled "approx." (PRD Q4). No Directions API call. |
| Places | activities, lodgings, car rentals with a resolved place | Distinct by place ref |
| Photo/video counts, time span | `blog_media_assets.captured_at` | min/max, count by `media_kind_key` |
| Planned vs. actual | activity `status` | `Completed` / `Cancelled` against the lifecycle in `utils/itineraryStatus.ts` |

The timeline rail (C3) is the same data emitted as a sorted list rather than aggregates, so it is one
service and one query set producing two projections. Each fact/timeline item includes
`sourceTypes[]`, `confidence` and `asOf`, and is filtered before derivation so it cannot reveal a
source the viewer is not authorized to see.

Spend is intentionally **not** produced by this server service. Project convention keeps splitting,
coverage rollup and currency conversion client-side in `app/utils/costs.ts`, `coveredBy.ts` and
`exchangeRates.ts`. The traveler client derives the spend chip from its already-authorized expense
payload; followers and public clients never receive the expense inputs. This avoids a second cost
algorithm and removes five-table facts from the most sensitive datum in the strip.

Facts are computed per request and cached in-process for `caching.tripBlog.factsCacheTtlMs`, keyed by
trip/day, actor audience class and the relevant source revisions. A local single-flight collapses
concurrent misses on one instance. Facts are not persisted: every input is already persisted
elsewhere, and stale materialized facts would be worse than a slightly slower request. The cache is a
P2 efficiency optimization under horizontal scale, never an authorization or correctness mechanism.

### 7.2 Trip recap

`blogRecapService.ts` aggregates across the whole trip: day count, total distance, distinct places,
media counts, per-contributor counts, top-reacted asset, most-commented day. This is genuinely
expensive, so results live in a small durable `blog_recap_snapshots` cache keyed on
`(tripId, contentRevision, engagementRevision, audienceClass)`, with state
`pending | ready | failed`, a claim lease and at most three retained revisions per trip.
`trip_blogs.content_revision` already exists and increments on content change; an
`engagement_revision` column is added by the same migration and bumped on engagement writes.

The first miss creates/claims the snapshot and returns `202`; a leased worker computes it once.
Concurrent instances either observe the same ready row or the same pending lease, so horizontal scale
does not multiply the aggregation cost. A private traveler recap may include a separately supplied
client-side spend card; persisted/public recap payloads never contain spend or precise photo location.

---

## 8. Day Starter assembly (A1)

**[confirmed]** — `blogDayStarterService.ts` is a **deterministic template**, not an LLM call:

```
sources = { transfers, activities, lodgings, carRentals, mediaCluster, weather }
if (nothing but media)      → "N photos from {weekday}" + place names from geotags, if enabled
if (itinerary data present) → sentence per source group, ordered by time, joined
```

It reuses `buildNarrativeBlogBody` from `server/src/blog/narrative.ts` for phrasing and the same data
`syncItineraryToBlog` already reads. Choosing a template over generation is deliberate: it is free,
fast, independent of an AI provider, gives identical output for identical inputs (which makes it testable), and
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

All **new** flags default `false`. Existing flags retain their checked-in values and are listed only
where this design consumes them:

| Flag | Gates |
|---|---|
| `trip_blog_social_layer` | Master kill switch for B1–B12; child flags below still apply |
| `trip_blog_reactions` | B1, B7 |
| `trip_blog_comments` | B2, B11 |
| `trip_blog_mentions` | B3 |
| `trip_blog_realtime` | B4, B9 |
| `trip_blog_authoring_assist` | A1, A2, A6 parent surface |
| `trip_blog_day_starter` | A1, A6 |
| `trip_blog_photo_composer` | A2 |
| `trip_blog_day_facts` | C1, C3, C5; C2 additionally requires existing fail-closed `trip_day_map` |
| `trip_blog_spend_summary` | C4 |
| `trip_blog_recap` | C7, B10 |
| existing `trip_blog_ai_highlights` | Explicit Day Starter rewrite only |
| `trip_blog_caption_ai` | A8 caption/alt suggestions; Premium/Pro |
| `notifications_outbox_enabled` | Master kill-switch for the notification delivery worker (§13.3) |
| `trip_blog_curation_stars` | B15 collaborative stars (§16.1) |
| `trip_blog_memory_lane` | B13 anniversary resurfacing (§16.2) |
| `trip_blog_milestones` | B16 engagement milestones (§16.3) |
| `trip_blog_reaction_bursts` | B14 burst animation (§16.4) |
| `trip_blog_group_prompts` | A12 rotating journaling prompts (§16.5) |
| existing `trip_blog_audio` | A9 capture modality only |
| `trip_blog_audio_transcription` | A9 provider transcription; Premium/Pro |
| `trip_blog_nudges` | B6 |
| `trip_blog_day_review` | C10/C11 correction/provenance UI |
| `trip_blog_public_engagement` | The unauthenticated public counts/comments endpoint (§14.7). Separate from `trip_blog_comments` on purpose: it must be switchable off without un-publishing a blog or disabling authenticated commenting. |
| `trip_blog_day_map_render` | The background day-map render job (§14.1). Gates the only new externally-billed call in the feature set, so it is fail-closed. |

`trip_blog_comments` implies moderation: `blogModerationService` is not separately flagged, because
shipping comments without it is not a configuration we want to be reachable.

Small presentation changes share the nearest parent flag; a separate flag per chip would create an
untestable configuration matrix. The following new write/external-cost flags are added to
`entitlementService.ts`'s existing `FAIL_CLOSED_FLAGS`: `trip_blog_social_layer`,
`trip_blog_comments`, `trip_blog_mentions`, `trip_blog_caption_ai`,
`trip_blog_audio_transcription`, `trip_blog_public_engagement`, `trip_blog_day_map_render`,
`trip_blog_curation_stars`, `trip_blog_memory_lane`, `trip_blog_group_prompts`,
`notifications_outbox_enabled`, `notifications_push` and
`notifications_web_push`, plus `notifications_in_app`. The general entitlement convention remains fail-open; these explicit
rollout exceptions match existing provider-backed exceptions such as `trip_day_map`. CI asserts that
every flag named here exists in YAML and the database seeding test.

### 9.2 Limits (`server/config/api-limits.yaml`)

There are two kinds of configuration and they are not interchangeable:

- Finite, DB-atomic aggregate admission caps live under `providers` and are enforced by
  `reserveApiUsageOrThrow(..., requireConfiguredLimit: true)` before work. Missing overall or caller
  configuration is a typed failure and keeps only that optional component unavailable.
- Payload/page/cache/concurrency settings live under `caching.tripBlog` (and
  `caching.notifications`). Route-local numeric constants are forbidden.

Initial canary caps (capacity assumptions, not product entitlements):

```yaml
providers:
  TRIP_BLOG_SOCIAL_API:
    window: day
    windowHours: 24
    overall: 100000
    callers:
      BLOG_DOCUMENT_READ: 30000
      BLOG_ENGAGEMENT_READ: 30000
      BLOG_REACTION_WRITE: 15000
      BLOG_COMMENT_WRITE: 5000
      BLOG_AUTHORING_WRITE: 5000
      BLOG_DAY_FACTS_READ: 10000
      BLOG_RECAP_BUILD: 500
      BLOG_MODERATION_WRITE: 500
      NOTIFICATION_INBOX_READ: 3000
      NOTIFICATION_PREFERENCE_WRITE: 500

  TRIP_BLOG_SOCIAL_STORAGE:
    window: day
    windowHours: 24
    overall: 610000
    callers:
      DATABASE_READ_UNIT: 500000
      DATABASE_WRITE_UNIT: 100000
      DATABASE_DELETE_UNIT: 10000

  # Capacity units are retained KiB, including a conservative index-overhead allowance.
  # reserveCapacityOrThrow finalizes/release idempotently as rows are created/pruned.
  TRIP_BLOG_SOCIAL_CAPACITY:
    overall: 2097152       # 2 GiB aggregate canary ceiling
    callers:
      COMMENT_RETAINED_KIB: 2097152
      REACTION_RETAINED_KIB: 2097152
      NOTIFICATION_RETAINED_KIB: 2097152
      RECAP_RETAINED_KIB: 2097152

  EXPO_PUSH:
    window: day
    windowHours: 24
    overall: 10000
    callers:
      BLOG_MENTION: 3000
      BLOG_REPLY: 3000
      BLOG_NUDGE: 2000
      BLOG_REACTION_DIGEST: 2000

caching:
  tripBlog:
    commentMaxLength: 2000
    commentMaxUtf8Bytes: 8192
    commentsPerMinutePerUser: 10
    commentsPerDayPerUser: 100
    reactionsPerMinutePerUser: 60
    reactionsPerDayPerUser: 500
    commentPageSize: 20
    commentPageSizeMax: 50
    replyPreviewCount: 3
    mentionsPerComment: 10
    commentEditWindowSeconds: 900
    hideStrikesBeforeBlock: 3
    maxCommentsPerUserPerTrip: 2000
    maxCommentsPerTrip: 20000
    maxReactionsPerTrip: 100000
    mediaGroupingCandidatesMax: 500
    signedUrlConcurrency: 8
    publicEngagementCacheTtlSeconds: 15
    publicEngagementStaleWhileRevalidateSeconds: 45
    factsCacheTtlMs: 60000
    # recapCacheTtlMs removed — the recap is a persisted `blog_recap_snapshots` row (§7.2),
    # not an in-process TTL cache. Retention is governed by tripBlogRecap.persistedTtlHours (§14.2).
    recapSnapshotsPerTrip: 3
    captionSuggestionsPerDayPerUser: 10
    captionSuggestionsPerMonthPremium: 100
    starterRewritesPerDayPerUser: 3
    starterRewritesPerMonthPremium: 30
```

External calls use existing providers where one exists: AI calls reserve
`OPENAI/BLOG_CAPTION_SUGGEST` or `OPENAI/BLOG_STARTER_REWRITE` (and the equivalent caller on the
active model provider); day maps reuse the already-limited `GOOGLE_STATIC_MAPS/TRIP_DAY_MAP`; email
fallback adds named callers under `SMTP`. Media upload/processing/storage continues through the
existing GCS, Cloud Run and per-uploader quota meters in `travel-blog-architecture.md` §15. No route
may claim that an operation is “free” as a reason to skip an admission counter.

Every provider attempt records actual request/token/byte units through the existing cost-accounting
path, including failed/retried attempts. Reservations use a bounded worst case; successful AI/media
work finalizes actual units and terminal pre-dispatch failure releases capacity where supported.

The model-provider caller caps are 200 caption suggestions/day and 50 starter rewrites/day within the
provider's existing overall budget; the same caller names/caps must exist under every selectable model
provider so switching providers cannot bypass them. Premium customer usage is separately reserved
through the entitlement usage architecture at 100 caption suggestions and 30 rewrites per UTC month.
Voice transcription reuses the existing `BLOG_AUDIO_TRANSCRIPTION` provider caller plus its existing
audio-minute tier reservation.

Each repository method declares conservative operation units (Firestore document operations for the
Firebase adapter; logical equivalents for Postgres/memory) and reserves them before the transaction.
Persistent social rows additionally use the existing `reserveCapacityOrThrow` lifecycle in retained
KiB, including worst-case body/payload and index overhead: comment 16 KiB, reaction 4 KiB,
notification+outbox 24 KiB, recap snapshot 64 KiB. Finalize once after commit and release on
prune/delete/terminal rollback. A failed operation may consume the operation reservation; idempotency
prevents a successful retry from being charged twice. Per-trip/user ceilings, notification retention
and recap pruning are secondary caps. Media bytes remain bounded by existing atomic worst-case byte
reservations, storage tiers, the 500 GB admin ceiling and `maxUploadBytesPerDay`.

### 9.3 Cost model and estimate

`server/config/cost-model.yaml` gains a `tripBlogSocial` usage block for Basic and Premium and cost
dimensions for Cloud Run requests, active-adapter database reads/writes/deletes, retained/index KiB,
static-map cache fills, push, email fallback, AI input/output tokens, and incremental media
storage/operations/egress. Existing `tripBlogStorage` dimensions are referenced rather than copied.
Every price records its source/effective date; a placeholder external-provider price blocks that
provider's rollout flag.

Base planning assumptions per active completed trip/month (replace with Stage 1 observations):

| Dimension | Base assumption | Current estimator rate | Approx. cost/trip-month |
|---|---:|---:|---:|
| Incremental Cloud Run requests | 300 | $0.40 / 1M | $0.0001 |
| Firestore reads (Firebase scenario) | 6,000 | $0.06 / 100k | $0.0036 |
| Firestore writes/deletes | 300 | $0.18 / 100k | $0.0005 |
| Structured/index retention | 1 MiB-month | $0.026 / GiB-month | <$0.0001 |
| Static-map cache fills | 12 | $0.002 / request | $0.0240 |
| 10 caption + 2 rewrite calls | 13k input / 2.1k output tokens | configured mini-model $0.15/$0.60 per 1M | $0.0032 |
| Incremental media retained | 0.5 GiB-month | existing blog storage $0.026 / GiB-month | $0.0130 |
| Incremental media egress | 1 GiB | existing CDN assumption $0.08 / GiB | $0.0800 |
| 1,000 object operations | 1,000 | existing $0.000004 / operation | $0.0040 |
| Push | 20 | provider price currently $0; still capped | $0.0000 |

Illustrative total: **about $0.13 per active trip-month**, of which media delivery/storage is about
$0.10. Social/recap structured-data and provider work without incremental media is about **$0.03**.
At 1,000 active completed-trip blogs/month, the base incremental estimate is therefore about **$130**.
This is a planning estimate, not a bill forecast; adapter, cache-hit ratio, media mix and geography
must be selectable estimator inputs.

The estimator also exposes a **cap-driven** scenario. With the canary values above, internal API
requests contribute at most about $1.20/month in Cloud Run request charges; Firebase read/write/delete
units about $15/month; the existing Static Maps monthly budget circuit breaker remains $15; and the
proposed AI caller caps (200 captions/day, 50 rewrites/day, with the token envelopes above) are about
$2.05/month. Thus the new non-media ceiling is approximately **$33/month plus signed push/email
prices**, plus at most about **$0.05/month** of structured retained bytes at the 2 GiB capacity cap,
before shared baseline hosting. Media is reported separately because its hard ceiling is the
sum of existing per-uploader tier reservations, not a social-feature allowance. Both average and
cap-driven totals appear in the admin estimator before any cost-bearing flag can leave internal use.

### 9.4 Observability and rollout telemetry

Schema-versioned events cover `blog_open`, `composer_open`, `first_save`, starter
shown/accepted/dismissed, reaction/comment outcome, conflict resolution, recap generated/shared and
notification opened. Dimensions are flag cohort, actor class, platform, target kind, bounded counts,
latency and typed outcome—never user text, precise location, spend, token, signed URL or raw provider
payload.

Operational metrics/alerts cover blog p50/p95/p99 and query count, media rows/signing concurrency,
counter drift, `409` rate, cache hit/miss, each limiter's utilization/rejections, moderation queue
age, outbox depth/oldest age/attempts/dead letters, recap lease age, provider cost and cost per active
blog. Alert thresholds and dashboard ownership are part of the phase exit criteria; sampled tracing
redacts IDs and bodies at instrumentation time rather than relying on a log scrubber later.

---

## 10. Failure modes

| Failure | Behaviour |
|---|---|
| Counter row drifts from source rows | Reads stay fast and slightly wrong. A DB-leased nightly reconciliation recomputes audience counters for trips with engagement writes in the last 24h; an admin repair endpoint supports an explicit trip. |
| Socket unavailable | REST unaffected. Client shows a "Reconnecting…" chip on the composer only, and refetches on reconnect. |
| Facts request fails | Day card renders without the fact strip and map. No error surfaced — a missing fact strip is indistinguishable from a day with no derivable facts, by design (FR-C1.1). |
| Recap generation times out | `202` + retry-after; UI shows a generating state. Never blocks the blog. |
| Caption AI unavailable | Suggest button disabled with a quiet tooltip. Uploads unaffected. |
| Any aggregate/tier limit is exhausted | Return a typed `429`/`402` for the affected optional action with retry/reset metadata; reading existing content and manual text authoring remain available wherever safe. Never fall through to an uncapped provider call. |
| Push/email provider unavailable | Durable inbox/outbox rows still commit. A leased worker retries with capped exponential backoff, then dead-letters; the originating comment/reaction succeeds. |
| Notification outbox backlog grows | Stop provider delivery at the configured queue/concurrency cap, keep in-app rows, alert on age/depth, and suppress nudges before mentions/replies. |
| pg-mem rejects a query | Caught by CI, since the memory adapter is what the test suite runs against. This is why the adapter matrix is NFR-2 rather than a nice-to-have. |
| Comment on an asset that is grace-hidden | Target resolution fails → `404`. Grace-hidden assets are already absent from `items`; engagement must not resurrect them. |
| Day-map render fails or the Static Maps budget is exhausted | The day card renders without a map, indistinguishable from a day with no geocoded points. The render job retries on the next points-hash change, never in a request path, and never blocks the page (§14.1). |
| `trip_blog_public_engagement` disabled or rate-limited | The public page renders exactly as it does today — content without counts. Engagement is a separate fetch precisely so its failure cannot affect the page (§14.7). |
| Storage reconciliation encounters a platform artifact | Generated day maps and recap payloads live under a reserved prefix excluded from uploader totals. Without that exclusion, reconciliation would bill a generated map to whichever user id appears in its object key (§14.4). |

---

## 11. Testing strategy

- **Authorization matrix (§4)** — a table-driven test over {traveler, owner, follower, admin,
  stranger, anonymous} × {day, item, asset} × {view, react, comment, edit, delete, hide} asserting
  the exact status code. This is the highest-value test in the program; write it before the routes.
- **Audience inheritance (§4.1)** — comment created private stays private after publication;
  comment created public disappears on revoke.
- **Counter consistency** — property test: N random reaction/comment/delete operations, then assert
  audience-partitioned counters equal a recomputed aggregate; account deletion scrubs comment bodies,
  deletes reactions and leaves correct tombstones/counters.
- **Adapter parity (NFR-2)** — the engagement repository suite runs against all three providers.
- **Read-path performance (NFR-1)** — a benchmark test on a seeded trip with 14 days, 300 assets and
  500 comments, asserting a bounded query count and payload size for `GET /:tripId/blog`, not only a
  wall-clock time. Assert signed URLs and comment threads are minted/fetched only for the visible page.
- **Public projection** — a snapshot test asserting no reactor names, no comment author emails, no
  geotags and no `travelers`-audience content in the public payload.
- **Day Starter determinism** — fixed fixtures produce byte-identical drafts.
- **E2E (Playwright, `app/e2e/`)** — react → reload → reaction persists; comment → second browser as
  a follower sees it; owner hides it; it disappears for both.
- **Idempotency and limits** — replay every write, contend at each aggregate/actor/storage cap, and
  assert the active DB counter never exceeds it across simulated instances. A repeated reaction `PUT`
  never clears state.
- **Realtime isolation** — traveler chat never reaches a follower subscribed to the blog; each
  audience class receives only allowed blog events. The two-instance test is owned by the horizontal
  scaling register and becomes a deploy gate before `max-instances` is raised.
- **Cost-estimator contract** — low/base/high and cap-driven scenarios include every named caller and
  storage dimension; a missing finite limit or price keeps the related flag off.
- **Export/deletion** — export contains the user's allowed social/notification records but no device
  secrets; deletion scrubs comment bodies, removes reactions/devices/outbox/inbox rows and releases
  every retained-capacity reservation.
- **Security threat table (§15.1)** — every row S1–S14 has a named test in its own column; the table
  is not considered reviewed until each one exists. The three most load-bearing: a `<script>` payload
  round-tripping as literal text through a comment *and* through AI-suggested alt text (S1/S2); a
  foreign trip's comment id returning `404` on every comment-id route (S3); and a member removed
  mid-session receiving no further socket events (S12).
- **Storage leak** — delete a trip and assert its day-map and recap artifacts are gone from blob
  storage; re-render a day map and assert the superseded object is removed rather than orphaned. The
  platform prefix is excluded from the uploader reconciliation pass, so nothing else would catch this.
- **Cost containment** — assert no request-path code reaches `GOOGLE_STATIC_MAPS`; assert every new
  external call site passes a caller key registered in `api-limits.yaml`; assert an exhausted
  provider budget degrades the surface rather than erroring the page.

Coverage gate: new route/service/repository/component modules target at least 90% changed-line and
85% branch coverage, without lowering repository thresholds. Numeric coverage does not replace the
matrix, property, adapter, projection, accessibility and two-context E2E tests above; every
authorization decision, limit-exhaustion branch and privacy projection needs a direct assertion.

---

## 12. Resolved architectural decisions

Answered. No item in this section blocks implementation.

### 12.1 Counter storage on Firebase — *resolved*

**Keep the repository interface identical; let each adapter implement it natively.** The interface is
`incrementCounters(targetKind, targetId, delta)`; Postgres satisfies it with an
`ON CONFLICT … DO UPDATE` upsert on `blog_engagement_counters`, Firestore with a native atomic
`FieldValue.increment`. Callers never learn which. The adapter parity suite asserts identical
observable behaviour, not identical mechanism — which is the existing convention in this repo
(`db.postgres.ts` and `db.firebase.ts` already diverge in mechanism throughout).

### 12.2 Single-instance realtime — *resolved, tracked separately*

**Accepted as a known limitation for this program.** Blog engagement inherits the in-process presence
and broadcast model that chat already uses; on a horizontally scaled deployment, cross-instance
broadcasts are silently dropped. REST remains correct, so this degrades freshness rather than
breaking data (FR-B4.2).

The requirements to lift this limitation are tracked in
**`docs/horizontal-scaling-requirements.md`** — this feature must not be the thing that discovers
them. Anything in this design that *adds* to that debt is recorded there as it is built.

### 12.3 Comment audience on audience change — *resolved in favor of PR-2*

Comments and reactions keep their creation-time audience. Publishing a blog or widening an item's
audience never rewrites existing engagement. A private family comment therefore cannot become public
because travelers later publish the blog. A user who comments on an already-public target sees the
persistent “Visible publicly” label and consents for that new comment (PR-8).

Narrow or broad audience sweeps are rejected for v1. They create surprising disclosure, make a
non-traveler's words subject to a vote they do not participate in, and invalidate the audience-aware
counter/cache model. If product later wants to move a thread between audiences, it needs an explicit
comment-author consent flow and a new migration—not an implicit side effect of publication.

Replacing an existing reaction emoji preserves that reaction row's audience. Clearing and later
creating a new reaction takes the target's then-current audience; counter updates move only when a
row is actually deleted/created, never on a replayed set.

### 12.4 Geotag extraction cost — *resolved: neither, because it moves client-side*

The question assumed extraction would happen in `blogMediaProcessingService.ts`. It should not, and
the assumption behind the question was wrong in a way worth stating: **the server never parses EXIF
at all** — sharp strips it — and `captured_at` is a client-supplied field that the client has never
actually populated. See the callout in §3.3.

Extraction moves client-side, alongside `capturedAt`, at `upload-init`. Cost answer:

| Approach | Compute cost | External API cost | Verdict |
|---|---|---|---|
| Client-side (chosen) | None on the server. Negligible on device — the picker already surfaces EXIF on native. | None | Chosen |
| Server-side `sharp().metadata()` | A metadata pass per photo, billed as Cloud Run CPU on the hot upload path | None | Rejected — real recurring cost for no benefit |
| Reverse-geocode lat/lng → place names | — | **Yes**, one Google Geocoding call per distinct location | Deferred. Not needed for C2; the map renders from coordinates. Only C6 (places index) would want it, and it can reuse `placeService.ts`'s existing DB-level cache. |

So: **just performance, and only on the client, and only marginally** — provided extraction stays on
the client and we do not reverse-geocode. Reverse-geocoding is the branch that would introduce real
per-call cost, and it is explicitly out of scope here.

### 12.5 Where notifications are dispatched from — *resolved: build a notification service*

**A first-class notification service is in scope**, replacing the email-only stopgap this document
previously assumed. Design in §13. This unblocks mentions (B3) and nudges (B6) properly rather than
building an email path that has to be unwound later.

---

## 13. Notification service

Resolves §12.5. This is genuinely new infrastructure — the repo has **no push notifications, no
in-app inbox, and no notification preferences today**. `expo-notifications` is not a dependency and
is not in the plugin list in `expo.config.shared.cjs`. The only outbound channel that exists is
transactional email via `smtpCallers.ts` (four senders: share, verification, trip invite, billing
reminder).

Because it is new infrastructure serving more than the blog, it is specified as an **app-wide
service that the blog is merely the first consumer of**. Nothing below is blog-specific except the
event categories.

### 13.1 Scope boundary

| In scope | Out of scope (for now) |
|---|---|
| In-app inbox (durable, read/unread) | SMS |
| Push to iOS/Android via Expo Push | Rich/actionable push (replying from the notification) |
| Per-category user preferences | Web push/service-worker/VAPID delivery (in-app inbox + socket cover web v1) |
| Permission request UX and denial handling | Digest scheduling beyond the B6 nudge cap |
| — | Marketing/promotional sends; a separate notification microservice |

Email stays as-is for the four existing transactional flows, and is available as a **user-enabled
fallback channel** for high-value notifications when push is unavailable or declined. Push denial
never silently opts somebody into email.

### 13.2 Data model — `20260901_add_notifications.sql`

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,          -- 'blog_mention','blog_comment_reply','blog_nudge','blog_reaction_digest'
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT,                  -- in-app route, e.g. trip/:id/blog?day=2026-05-14#comment-:id
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMP,
  seen_at TIMESTAMP,               -- surfaced in the inbox, vs. actually opened
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  dedupe_key TEXT,                 -- collapse duplicates: one row per logical event per user
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, created_at) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  push_token_ciphertext TEXT NOT NULL,
  push_token_hash TEXT NOT NULL,
  device_label TEXT,
  permission_state TEXT NOT NULL DEFAULT 'granted'
    CHECK (permission_state IN ('granted','denied','undetermined','revoked')),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  failure_count INTEGER NOT NULL DEFAULT 0,
  disabled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, push_token_hash)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  in_app BOOLEAN NOT NULL DEFAULT TRUE,
  push BOOLEAN NOT NULL DEFAULT TRUE,
  email BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS notification_thread_mutes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, thread_key)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('push','email')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','sent','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMP,
  last_error_code TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (notification_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_claim
  ON notification_outbox(state, next_attempt_at, created_at);
```

`dedupe_key` is the mechanism behind FR-B6.1's cap, and it prevents the obvious failure where twenty
reactions on one photo produce twenty notifications. Reactions never notify individually — they roll
up into a digest row keyed on `(day, date-bucket)`.

A missing `notification_preferences` row means the checked-in category defaults apply: mentions and
direct replies allow in-app/push, nudges allow in-app only, reaction digests are off. An unknown
category resolves fully off. This is a deliberate departure from entitlement fail-open behavior:
notifications are outbound actions aimed at a person. Resolution order is explicit row → known
category default → off. A thread mute then overrides every delivery channel for that thread.

Push tokens are secrets: the application stores encrypted ciphertext plus a deterministic keyed hash
for uniqueness, never logs either, never returns a token from a GET route, and scrubs it on logout,
account deletion or `DeviceNotRegistered`. Notification payload JSON is capped at 4 KiB and contains
IDs/deep-link routing only; private comment text, spend and coordinates are not stored in the payload.

### 13.3 Service shape

```
server/src/services/notificationService.ts            NEW
  notify({ userIds, category, tripId, actorUserId, title, body, deepLink, payload, dedupeKey })
    → resolve preferences per user (defaults applied, never fail-open)
    → in the caller's transaction, write the `notifications` row when in_app
    → write at most one push/email outbox row for enabled channels
    → return created IDs; after commit, best-effort emit NOTIFICATION_CREATED to user rooms

server/src/services/notificationOutboxWorker.ts       NEW
  claim batch with DB transaction/lease
    → reserve EXPO_PUSH or SMTP caller before provider work
    → batch push to the configured maximum
    → mark sent, retry with capped exponential backoff, or dead-letter

server/src/apis/expoPushApi.ts + expoPushCallers.ts    NEW
  Follows the existing apis/ + callers/ split (openaiApi/openaiCallers, smtpApi/smtpCallers).
  Batches to 100 per request per Expo's documented limit; on DeviceNotRegistered, disables the row.

server/src/routes/notificationRoutes.ts                NEW
  GET    /api/notifications              ?cursor=&unreadOnly=
  POST   /api/notifications/read         { ids[] | all: true }
  GET    /api/notifications/preferences
  PATCH  /api/notifications/preferences
  PUT    /api/notifications/thread-mutes/:threadKey
  DELETE /api/notifications/thread-mutes/:threadKey
  POST   /api/notifications/devices      { platform, pushToken, deviceLabel }
  DELETE /api/notifications/devices/:id
```

`notify()` is the **only** entry point. No route or service constructs a push payload directly, so
preference resolution and dedupe cannot be bypassed. Provider I/O never runs in the comment/reaction
request. The transactional outbox closes the crash window between committing a notification and
sending it, and its lease makes delivery safe across multiple server instances.

Provider delivery is **at least once**, not magically exactly once: a worker can crash after a
provider accepts a batch but before `sent` commits. Every push carries the stable `notificationId` and
the client suppresses duplicate display/inbox insertion. Use a provider idempotency key where
supported; otherwise rare duplicate email/push is an accepted failure mode bounded by attempts. Cost
accounting records every provider attempt, not only successful deliveries.

### 13.4 Client

| Piece | File | Notes |
|---|---|---|
| `expo-notifications` dependency + plugin | `app/package.json`, `expo.config.shared.cjs` | Plugin entry alongside `expo-image-picker`; needs an APNs key and FCM config in EAS credentials |
| Permission request | `app/utils/notificationPermissions.ts` NEW | See §13.5 |
| Token registration | `app/utils/notifications.ts` NEW | Register on login, re-register on token change, delete on logout |
| Inbox UI | `app/components/NotificationBell.tsx`, `NotificationPanel.tsx` NEW | Model on the existing `ChatButton.tsx` / `ChatPanel.tsx` pair, which already solves badge-plus-panel against a socket |
| Preferences UI | `app/tabs/account.tsx` | Per-category toggles |
| Deep-link handling | `app/App.tsx` | Route a tapped notification to trip + tab + anchor |

Web v1 uses the in-app inbox plus authenticated socket delivery. Web push would require a service
worker, VAPID key lifecycle, browser-specific permission/revocation handling and a separate provider
adapter; it is deferred until mobile push engagement proves that cost worthwhile. The web build does
not request notification permission.

### 13.5 Permission handling

**What "one-shot" actually means.** The user's *choice* is never permanent — on both platforms they
can change it at any time in OS settings (iOS: Settings → Notifications → WanderBunnies; Android:
Settings → Apps → WanderBunnies → Notifications). What is one-shot is the **in-app prompt**: iOS
shows the `requestAuthorization` dialog once, and every later call returns the stored answer
silently, with no dialog. So the app cannot re-ask — recovery requires the user to walk to Settings
themselves.

That distinction matters for how hard we protect the prompt. A denial is not fatal, it is
*expensive*: the path back exists but takes several deliberate steps that most people never take. So
the prompt is still worth spending carefully, but a denial should be treated as a recoverable state
we can invite the user out of later, not a permanent loss.

Rules:

1. **Never request on app launch.** Request at the first moment the value is legible — immediately
   after a user posts their first comment, or joins their first trip as a follower.
2. **Pre-prompt first.** An in-app explanation precedes the OS dialog. Declining the pre-prompt means
   the OS dialog is never shown, so it can be offered again later.
3. **Denial is a normal state, not an error.** `permission_state` is recorded, the app degrades to
   the in-app inbox plus explicitly enabled email fallback, and never nags. Because the app can no longer prompt (see
   above), account preferences carry a single "Enable notifications" row that calls
   `Linking.openSettings()` — that deep link is the *only* recovery path, so it must be present and
   findable rather than buried.
4. **Re-check on foreground.** Users revoke permission outside the app; refresh `permission_state`
   on resume and disable the device row if revoked.
5. **Blog notifications are opt-out once permission exists** — except reaction digests, which default
   off. Mentions default on: being mentioned and not knowing is the worse failure.


#### Platform specifics

| | iOS | Android |
|---|---|---|
| Can the user change it later? | Yes — Settings → Notifications → WanderBunnies | Yes — Settings → Apps → WanderBunnies → Notifications |
| Can the app re-prompt after denial? | **No.** `requestAuthorization` returns the stored answer without showing a dialog. | **Sometimes.** Android 13+ (API 33) `POST_NOTIFICATIONS` is a runtime permission and may be re-requested, but the OS stops showing it after two denials. Below API 33, notifications are granted at install and there is no prompt at all. |
| Deep link to settings | `Linking.openSettings()` | `Linking.openSettings()` |
| Quiet middle ground | **Provisional authorization** (iOS 12+): notifications are delivered silently to Notification Center with *no prompt at all*, and the user can promote them to full alerts from the notification itself. | No direct equivalent. |

**Provisional authorization is worth evaluating** before committing to the pre-prompt flow. It
inverts the problem: instead of asking permission before the user has seen any value, notifications
start arriving quietly and the user opts *up* once one of them proves useful. For a blog-mention
notification — inherently low-volume and high-relevance — that is arguably the better fit, and it
costs nothing if the user ignores it. The tradeoff is lower visibility: provisional notifications do
not light up the lock screen, so a time-sensitive nudge may go unseen. Decide per category, not
globally.

**Android notification channels are a second preference store, and that is a trap.** If categories
map to OS channels, a user can disable a channel in Android settings while our
`notification_preferences` row still says `push = true`. The two will disagree, and our table will be
wrong. Rule: **the OS is always authoritative for delivery; our table is authoritative for intent.**
We never write to our table based on channel state, we never claim in the preferences UI that a
category is on when its channel is off, and the preferences screen reads live channel state on
Android to render an accurate "blocked in system settings" hint next to the toggle.

### 13.6 What this changes elsewhere in this design

- **B3 (mentions)** dispatches through `notify()` with `category='blog_mention'`, once per mention on
  creation only (FR-B3.2), `dedupeKey = comment:{id}:mention:{userId}`.
- **B6 (nudges)** becomes a scheduled job calling `notify()` with `category='blog_nudge'`. The 72h
  cap is enforced by `dedupe_key` plus a job-side window check, rather than bespoke logic.
- **B1 (reactions)** gains a digest category, default off.
- **§10's failure table** gains: *push provider unavailable → the in-app row is still written; the
  outbox retries within configured attempt/age caps, then dead-letters.* A notification is never
  blocking, and `notify()` never throws provider failure into a request path.
- **§12.2 applies here too.** Socket delivery of `NOTIFICATION_CREATED` inherits the single-instance
  limitation; push/outbox and the durable inbox row do not. Notifications therefore stay *correct* when
  scaled horizontally — only their liveness degrades. Recorded in
  `docs/horizontal-scaling-requirements.md`.

### 13.7 New flags and limits

```yaml
# feature-flags.yaml
  notifications_in_app:     { enabled: false }
  notifications_push:       { enabled: false }
  notifications_web_push:   { enabled: false } # reserved, follow-on; no v1 code path
```

`notifications_in_app=false` stops new inbox rows and hides the client surface while retaining old
rows for normal expiry. `notifications_push=false` stops new push outbox rows without disabling the
inbox. Channel flags are checked before capacity reservation/outbox creation and never override a
user's more restrictive preference.

```yaml
# api-limits.yaml — non-admission settings; finite provider callers are in §9.2
caching:
  notifications:
    pushBatchSize: 100
    outboxClaimBatchSize: 100
    outboxMaxAttempts: 4
    outboxMaxAgeHours: 24
    outboxConcurrency: 2
    maxNotificationsPerUserPerDay: 50
    maxPerUserPerHour: 20
    inboxPageSize: 30
    inboxPageSizeMax: 50
    deviceTokenMaxPerUser: 10
    retainedRowsMaxPerUser: 5000
    retentionDays: 90
```

`EXPO_ACCESS_TOKEN` is read via `getEnvValue()` and supports the `_FILE` suffix, per the existing env
convention. `NOTIFICATION_TOKEN_ENCRYPTION_KEY` follows the same secret path; ciphertext records carry
a key version so rotation can decrypt/re-encrypt without downtime, while uniqueness hashes use a
separate keyed value. Notification rows older than `retentionDays` or beyond `retainedRowsMaxPerUser` are
pruned by a DB-leased `retentionService.ts` run. Push reserves the `EXPO_PUSH` callers from §9.2;
email adds `BLOG_MENTION_FALLBACK`, `BLOG_REPLY_FALLBACK` and `BLOG_NUDGE_FALLBACK` beneath the
existing `SMTP` aggregate cap. Storage/read/write units reserve under
`TRIP_BLOG_SOCIAL_STORAGE`. The cost model includes provider messages even while their configured
price is zero, so adopting a paid push/email tier is a price update rather than an estimator redesign.

---

## 14. Cost, quotas and caching

Added after a review pass against the existing API-limiting architecture. **Every new external call
and every new stored byte below is capped in `api-limits.yaml`, priced in `cost-model.yaml`, and has
a named caller** — the same contract every other provider in this repo already follows
(`GOOGLE_STATIC_MAPS`, `OPENAI`, `UNSPLASH`, `SMTP`, …). Nothing in this feature set may reach an
external provider through an uncapped path.

### 14.1 The day map was the expensive mistake — corrected

An earlier draft of this document had C2 "reuse `TripDayMap.tsx` and `staticMapRoutes.ts`" directly.
That reuse is correct for the *client*, and badly wrong for the *cost model*, for three compounding
reasons:

1. **Volume is per-day, not per-dialog.** The existing `TRIP_DAY_MAP` caller is capped at 300/day
   against a `GOOGLE_STATIC_MAPS` budget of **$15/month** (`api-limits.yaml`). A blog day map renders
   once per *day card*: a 14-day trip is 14 calls for one page view.
2. **The cache is in-process.** `staticMapRoutes.ts` uses `createTtlCache` with a 24h TTL. That cache
   dies with the instance and multiplies by instance count — so the effective call rate is
   (unique day-maps) × (instances) × (restarts per day), not (unique day-maps).
3. **The public page is unauthenticated and crawlable.** `publicBlogRoutes.ts` sets
   `X-Robots-Tag: index,follow` when indexing is enabled. A crawler walking published blogs would
   draw map renders at whatever rate it likes.

Rough arithmetic: 100 published trips × 14 days = 1,400 distinct day maps. At a 24h TTL that is
~42,000 renders/month against a budget of roughly 7,500. **The budget is exceeded by ~5× before any
growth**, and the first symptom would be `ApiBudgetExceededError` breaking unrelated map features.

**Corrected design — render once, store, never re-render.** A day map is a function of that day's
points, which stop changing when the trip ends. So:

- The map is rendered **once per (trip-day, points-hash)** by a background job, not during a request.
- The rendered PNG is written to the **existing blog media bucket** via `blogStorageClient.ts` under
  a reserved rendition key, and served through the existing signed-URL/CDN path that every blog photo
  already uses.
- Re-render happens only when the points hash changes (an activity added, a lodging moved), debounced
  to at most once per day per trip-day.
- The public projection serves the stored image. **No public request ever triggers a Google call.**

Cost becomes bounded by *number of trip-days that ever existed*, not by views, instances, restarts or
crawlers. It also removes the day map from the horizontal-scaling cost multiplier entirely
(`horizontal-scaling-requirements.md` row 11).

Storage impact: a 640×400 PNG is ~80 KB. 1,400 day maps ≈ 110 MB — negligible against the existing
media footprint, and it is **platform storage, not charged to the uploader's ledger** (a generated
artifact is not a traveler's upload; see 14.4).

```yaml
# api-limits.yaml — GOOGLE_STATIC_MAPS.callers
      BLOG_DAY_MAP_RENDER: 200        # background render job only; never request-path
```

The client keeps `TripDayMap.tsx` for the *interactive planning* surface it already serves. The blog
uses the stored image. This is the one place in this design where reuse was the wrong instinct.

### 14.2 New provider and caller entries

```yaml
# api-limits.yaml
providers:
  GOOGLE_STATIC_MAPS:
    callers:
      BLOG_DAY_MAP_RENDER: 200

  OPENAI:
    callers:
      BLOG_CAPTION_SUGGEST: 300       # A8, on demand only, never on upload
      BLOG_STARTER_REWRITE: 100       # A1 "Rewrite", explicit user action
      BLOG_AUDIO_TRANSCRIBE: 50       # A9, Phase 7

  EXPO_PUSH:                          # new provider — free service, throttled anyway
    window: hour
    windowHours: 24
    overall: 20000
    callers:
      NOTIFY_MENTION: 5000
      NOTIFY_NUDGE: 5000
      NOTIFY_DIGEST: 10000

  SMTP:
    callers:
      NOTIFY_EMAIL_FALLBACK: 200      # see the warning in 14.3
```

```yaml
# api-limits.yaml — tripBlog limits (additions to §9.2)
  publicEngagementReadsPerMinutePerIp: 60
  mentionAutocompletePerMinutePerUser: 20
  reportsPerDayPerUser: 20
  dayMapRerenderMinIntervalHours: 24
  recapGenerationsPerDayPerTrip: 5
```

```yaml
# api-limits.yaml — caching additions
  tripBlogEngagement:
    publicCountsCacheTtlSeconds: 120
    counterBatchSize: 200
  tripBlogRecap:
    persistedTtlHours: 24
```

```yaml
# cost-model.yaml — requestPricing
  EXPO_PUSH: 0                        # genuinely free today; entry exists so it is visible
  BLOG_DAY_MAP_RENDER: 0.002          # Google Static Maps per-request, same as STATIC_MAP_PREVIEW
```

`cost-model.yaml` `usagePerUser` additions, per tier, modelling a typical month:

| Tier | `expoPush.messages` | `openai` (caption/rewrite) | `googleStaticMaps.requests` | `smtp.messages` |
|---|---|---|---|---|
| Basic | 20 | 0 (AI captions Premium-only — see 14.5) | 0.5 | +1 |
| Premium | 60 | input 8,000 / output 2,000 | 1.5 | +2 |

`googleStaticMaps` is fractional per user by design: renders are per trip-day, amortised across
everyone who views that trip.

### 14.3 The SMTP fallback is a real risk

`SMTP` is throttled at **100/day aggregate** today, and `cost-model.yaml` already warns that 1
message/user/month exceeds that at 10k users. Notification email fallback (§13.3) could add far more
than that.

**Rule: email fallback is not a general channel.** It fires only for `blog_mention`, only when the
user has no enabled push device, and never for nudges or digests. `NOTIFY_EMAIL_FALLBACK` is capped
at 200/day, and exceeding it degrades to in-app-only rather than throwing. Nudges (B6) are
**push-and-inbox only**; a nudge is by definition low-urgency and does not justify an email.

### 14.4 Storage accounting

The blog already has a per-uploader ledger with grace-hiding and paid add-ons. Two new byte sources
must be classified explicitly or they will silently land in the wrong bucket:

| New bytes | Charged to | Rationale |
|---|---|---|
| Voice notes (A9, `media.audio`) | **Uploader's ledger**, like any other media | It is a traveler's upload; the existing quota and Premium gate apply unchanged |
| Rendered day maps (14.1) | **Platform**, not any user | A generated artifact from data the user already stored. Charging it would make a traveler's quota depend on how many activities they logged. |
| Persisted recap payloads (14.6) | **Platform** | Same reasoning; kilobytes of JSON |
| Comments, reactions, notifications | **Platform** | Row storage, not media. Bounded by `retentionDays` for notifications. |

`blog_storage_ledger` entries are written only for the uploader-charged row. Platform artifacts use a
reserved storage prefix excluded from `blogStorageReconciliationService` totals — **this must be an
explicit exclusion**, or reconciliation will attribute generated maps to whichever user id appears in
the object key.

**Excluding them from reconciliation means nothing reaps them.** That exclusion solves the billing
problem and creates a leak: reconciliation is what currently walks blob storage and deletes orphans,
so a prefix it skips accumulates forever. Two rules close it:

- **Trip deletion deletes the trip's platform artifacts.** The existing guarantee in
  `travel-blog-architecture.md` — deleting a trip permanently deletes that trip's blog content — must
  cover generated day maps and recap snapshots, which are derived from that trip and meaningless
  without it. Artifacts are keyed by `tripId` precisely so this is a prefix delete, not a scan.
- **A superseded artifact is deleted when its replacement is written.** A day map re-rendered on a
  points-hash change orphans the previous hash's object. The render job deletes the old key in the
  same operation that promotes the new one.

A second reconciliation pass covers the platform prefix on its own schedule: it reaps artifacts whose
`tripId` no longer exists and artifacts whose points-hash is no longer current. It never touches
uploader-charged objects, and it never writes to `blog_storage_ledger`.

### 14.5 Cost-driven feature gating

Resolving PRD open question 2:

- **AI captions and Day Starter rewrite are Premium-only.** They are the only per-photo,
  per-external-call features in the set, and photo counts scale without bound. Gate via
  `assertCanUseFeature(userId, 'trip_blog_caption_ai', role)`, evaluated against the **requesting**
  account — consistent with how Premium video eligibility already works.
- The deterministic Day Starter (§8) is **available to every tier**, because it costs nothing. This
  is the main reason the template-not-LLM decision matters commercially, not just architecturally:
  the highest-value authoring feature stays free.
- Reactions, comments, facts, maps and recap are all-tier. None has a meaningful marginal cost.

### 14.6 Caching strategy, corrected

The original §7 put day facts and the recap in in-process TTL caches. On Cloud Run with short-lived
instances that is close to a no-op, and it multiplies rather than reduces cost for anything with an
external call behind it. Revised:

| Surface | Strategy | Why |
|---|---|---|
| Day facts (C1/C3) | In-process TTL, 60s | Pure DB aggregation, no external call. Cheap to recompute; a low hit rate costs little. Keep. |
| Day map (C2) | **Persisted artifact in blob storage**, re-rendered on points-hash change | Has an external paid call behind it. Must never be recomputed on a cache miss. See 14.1. |
| Trip recap (C7) | **Persisted row** — `blog_recap_snapshots`, already specified in §3 and §7.2 | Expensive aggregation, changes rarely, read often, shared across viewers. Already correct; listed here for completeness. |
| Engagement counters | No cache — read the counter table directly | The counter table *is* the cache. A second layer only adds staleness. |
| Public engagement counts | HTTP `Cache-Control: public, max-age=120` on a **separate endpoint** | See 14.7. |
| Blog document | Unchanged | Not made worse by this work. |

### 14.7 Public page caching and NFR-6

NFR-6 requires that a new comment not invalidate the whole public page. `publicBlogRoutes.ts` serves
`Cache-Control: public, max-age=60, stale-while-revalidate=300`. Embedding engagement in that payload
would couple comment freshness to page caching and make every comment a cache-busting event.

**So engagement is not in the public blog payload at all.** It is served from a separate endpoint:

```
GET /api/public/:username/:tripSlug/engagement    →  { counts: {...}, comments: [...] }
    Cache-Control: public, max-age=120, stale-while-revalidate=600
    Rate limit: publicEngagementReadsPerMinutePerIp (60), by hashed IP
```

The page HTML/JSON stays cacheable and stable; engagement hydrates separately and is allowed to be up
to two minutes stale, which is entirely acceptable for a public read-only view. This also means the
public path shares no code with the authenticated engagement routes, so there is no way for an
authorization change on one to silently affect the other.

**This endpoint is unauthenticated and therefore the most abusable surface in the feature.** It gets
its own rate limit (above), returns counts and public-audience comments only, never reactor or author
user ids, and is behind its own flag `trip_blog_public_engagement` so it can be switched off without
un-publishing anything.

---

## 15. Security review

§4 covers *authorization* (who may act on what). This section covers everything else, and exists
because this feature introduces the app's first **user-generated text authored by one user and
displayed to another**, plus its first **unauthenticated write-adjacent surface**. Both are new
attack classes for this codebase.

### 15.1 Threat table

| # | Threat | Surface | Mitigation | Test |
|---|---|---|---|---|
| S1 | Stored XSS via comment body on the public page | `blog_comments.body` | Plain text only; no HTML parse, no markdown render, no `dangerouslySetInnerHTML`. Rendered through React `<Text>` which escapes by construction. | Snapshot test asserting a `<script>` payload round-trips as literal text |
| S2 | Stored XSS via `caption` / `alt_text` | Already exists; **A8 makes it worse** by writing AI output into `alt_text`, which lands in an HTML attribute on the public page | Strip control chars and quotes from AI-suggested alt text before persist; escape at render | Payload test through the AI-suggestion path |
| S3 | IDOR on comment mutation | `PATCH`/`DELETE`/`report`/`hide` `/blog/comments/:commentId` | These take a *comment* id, not a target — `resolveEngagementTarget` does **not** cover them. A parallel `resolveComment(actor, tripId, commentId)` must verify the comment belongs to `:tripId` **and** is visible to the actor, returning `404` otherwise. | Matrix test extended to comment-id routes with a foreign trip's comment id |
| S4 | User enumeration via mention autocomplete | `GET /blog/mentionable?q=` | Trip-scoped (PR-7) **plus** a rate limit (`mentionAutocompletePerMinutePerUser: 20`) and a minimum query length of 2. Returns display names and ids of trip members only. | Non-member query returns empty, not 403; rate limit enforced |
| S5 | Open redirect / deep-link injection | `notifications.deep_link` | `deep_link` is **never** user-supplied. It is constructed server-side from an allowlisted route template plus validated ids. The client refuses any deep link not matching a known route pattern. | Client rejects an absolute URL in `deep_link` |
| S6 | Push token theft / spoofing | `POST /notifications/devices` | Token rows are bound to the authenticated user; registering a token already owned by another user **reassigns** it (the device changed hands) rather than duplicating. Tokens are never returned by any read endpoint. | Token registered by user A then by user B belongs only to B |
| S7 | Notification content leakage on lock screen | Push payload | Push body carries the actor's display name and a truncated snippet only — never full comment bodies, never anything from a `travelers`-audience item to a follower's device. Audience is re-checked at send time, not at enqueue time. | Follower does not receive a `travelers`-audience mention body |
| S8 | Mass-report abuse to suppress content | `POST /comments/:id/report` | Reports never auto-hide. Hiding is always a human action by the owner or an admin (FR-B11.2). `reportsPerDayPerUser: 20`; `UNIQUE(comment_id, reporter_user_id)` prevents report stacking. | 20 reports do not change comment visibility |
| S9 | Unauthenticated scraping / DoS of public engagement | `GET /api/public/.../engagement` | Own flag, own rate limit by hashed IP (`hashRateLimitIdentity` already exists), counts-and-public-comments only, aggressively cached (14.7). | Rate limit returns 429 with `Retry-After` |
| S10 | Signed media URL leakage through engagement payloads | Comment/reaction responses | Engagement payloads carry **asset ids, never signed URLs**. URL minting stays exclusively in the existing `attachMediaUrls` path. | No response from an engagement route matches a signed-URL pattern |
| S11 | Idempotency-key replay across users | `POST .../comments` | Idempotency keys are scoped `(user_id, key)`, never global. A replayed key returns the original comment, never creates a second. | Same key from a different user creates a distinct comment |
| S12 | Socket room leakage of private engagement | `blog:comment_created` | Per-socket audience filtering (§6 rule 2). The socket's cached role must be **invalidated on membership change** — a removed traveler holding an open socket must stop receiving. | Remove a member mid-session; assert no further events |
| S13 | Comment content in the public sitemap / structured data | `blogSitemapRoutes.ts` | Comments are excluded from sitemap and Schema.org output entirely. They are not the trip's content and should not shape its search presence. | Sitemap snapshot contains no comment text |
| S14 | Geotag leakage via the rendered day map | 14.1 stored map artifact | Two artifacts are rendered when photo geotags are enabled: a traveler version including photo pins, and a public version with itinerary points only. The public projection can only reference the public artifact. | Public artifact key never appears alongside photo-derived points |

S14 is worth calling out as a design consequence rather than just a control: because the map is now a
*stored artifact* (14.1) rather than a per-request render, the audience decision moves from request
time to render time. Getting it wrong bakes private location data into a cached public object, which
is far harder to walk back than a bad response. Two artifacts, chosen by projection, is the only safe
shape.

### 15.2 Standing rules

- **No user input reaches an HTML context.** Comments, captions and alt text are text nodes or
  escaped attributes. This is asserted by test, not by review.
- **Every new endpoint is rate limited** through `httpRateLimitService`, which is already DB-backed
  and atomic (`atomicIncrementApiUsageIfUnderLimit`) and therefore correct across instances.
- **Every new external call goes through `reserveApiUsageOrThrow`** with a named caller (§14.2). A
  call site without a caller key is a review blocker.
- **Audience is re-evaluated at every boundary** — read, socket emit, push send, public projection —
  never cached and trusted from an earlier evaluation.
- **Moderation actions write `audit_log`**, matching the existing admin-mutation convention.
- **PII in notifications is minimised**: display names, not emails; snippets, not bodies.

---

## 16. Late-added features (A12, B13–B16)

These five arrived in the PRD after §§1–15 were written and had **no design and no plan tasks**. Each
one turns out to carry a cost, scale or schema implication that is not obvious from its one-line
summary, which is why they are designed here rather than waved through as "UI polish".

### 16.1 B15 Collaborative Star Curation — needs a schema change, not reuse

The PRD implies this is a light feature. It cannot be built on the existing table.

`blog_item_highlights` (shipped, `20260723_add_trip_blog_media.sql`) is:

```sql
CREATE TABLE blog_item_highlights (
  item_id UUID PRIMARY KEY REFERENCES blog_items(id) ON DELETE CASCADE,
  starred_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

`item_id` is the **primary key**, so an item can hold exactly one star. `setHighlight` in
`postgresMediaRepository.ts` confirms the behaviour: it upserts with
`ON CONFLICT (item_id) DO UPDATE SET starred_by_user_id`, so a second traveler starring an item
**silently replaces the first traveler's star**, and `DELETE … WHERE item_id = $1` lets any traveler
clear a star they did not set. That is a single-user bookmark, and "collaborative curation" is the
opposite of it.

Two changes required:

1. **Primary key becomes `(item_id, starred_by_user_id)`** so stars accumulate per user. Delete
   becomes scoped to the calling user. This is a **breaking change to a shipped table** and needs a
   migration that preserves existing rows (they migrate cleanly — each becomes the sole star).
2. **Photos need an asset-level target.** A gallery member has no `blog_items` row of its own — it is
   one asset inside a `core.gallery` item (see the flattening in `blogRoutes.ts`). Starring "a photo"
   therefore cannot use `item_id` at all. Rather than inventing a third addressing scheme, B15 reuses
   the **same polymorphic target** the engagement tables already use (§3.1), replacing
   `blog_item_highlights` with:

```sql
CREATE TABLE IF NOT EXISTS blog_curation_stars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('item','asset')),
  blog_item_id UUID REFERENCES blog_items(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK ( /* exactly-one-target, as §3.1 */ )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_curation_star_item  ON blog_curation_stars(blog_item_id, user_id) WHERE blog_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_curation_star_asset ON blog_curation_stars(asset_id, user_id)     WHERE asset_id     IS NOT NULL;
```

`blog_item_highlights` is migrated into it and eventually dropped — but **not in the same
migration**. Dropping a shipped table in the migration that replaces it makes a server rollback
unrecoverable: the previous binary still reads `blog_item_highlights` and would fail on a table that
no longer exists. Use expand/contract instead:

1. **Expand** (Phase 6b): create `blog_curation_stars`, backfill from `blog_item_highlights`, and
   dual-write both tables. Reads come from the new table.
2. **Contract** (a later phase, after the rollback window has passed and no client is calling the
   shim): stop dual-writing, then drop `blog_item_highlights` in its own migration with its own
   rollback file.

The existing
`POST /:tripId/blog/items/:itemId/highlight` route is kept as a **compatibility shim** that writes
the new table (it is already shipped and a native client may still call it), and a new
`PUT /:tripId/blog/:targetKind/:targetId/star` becomes the real endpoint. Stars resolve through
`resolveEngagementTarget` like everything else — a curation star is an engagement act and must not
get its own authorization path.

**Interaction with B7 and C7.** Stars are *explicit curation*; reactions are *popularity*. The recap's
Top Highlights takes starred items first, then fills from reaction counts. That ordering is the whole
point of B15 — it lets a group promote the meaningful photo over the merely popular one.

### 16.2 B13 Memory Lane — the highest-risk item in the set

A one-line PRD entry that is, architecturally, an **unbounded scheduled fanout to an audience that
did not opt in on that day**. Four problems, all solvable, none free:

1. **Burst shape.** Anniversaries are date-aligned. Every trip that started on 14 May fires on 14 May.
   Notification volume is not smooth — it spikes, and it spikes hardest in the months that were
   popular travel months a year ago.
2. **Follower fanout.** A trip with 40 followers is 41 notifications from one trip-day. Volume scales
   with `trip_followers`, which has no cap.
3. **Stale consent.** A blog published a year ago may since have been revoked (§4.2 makes revocation
   unilateral and immediate). Resurfacing it to followers a year later would defeat that revocation.
4. **A new scheduled job**, inheriting every problem in `horizontal-scaling-requirements.md` rows 9
   and 15a/15b — N instances means N copies of every anniversary notification.

Design:

- Runs as a **leased daily job** using the §12.2 / register §3.3 claim pattern. Never per-request.
- **Re-checks publication state at send time, not at enqueue time.** A revoked or private blog
  produces no follower notification, ever. Travelers still get theirs — it is their own trip.
- **Followers are opt-in for Memory Lane specifically**, as a distinct notification category
  (`blog_memory_lane`) defaulting **off** for followers and **on** for travelers. A year-old trip is a
  fond memory to the people who took it and unsolicited mail to everyone else.
- **Capped and smoothed**: `memoryLaneNotificationsPerDay` bounds the global daily fanout; overflow
  defers to the next day rather than dropping, since an anniversary is not time-critical to the hour.
- **Only for trips with real engagement** — a trip with no published days and no reactions produces
  nothing. Reviving a dead trip is not a memory, it is spam.

```yaml
# api-limits.yaml — tripBlog
  memoryLaneNotificationsPerDay: 2000
  memoryLaneMinEngagementScore: 5
  memoryLanePerUserPerYear: 12
```

### 16.3 B16 Engagement Milestones — derive from the counter, never scan

The naive implementation queries counts to test thresholds, which puts a read on the reaction write
path and fires the toast once **per viewer** rather than once per milestone.

- The counter update in `blogEngagementService` already returns the new total. A milestone crossing is
  therefore detectable as `previousTotal < threshold <= newTotal` — **no extra query**.
- Crossings are recorded in `notifications` with
  `dedupe_key = trip:{id}:milestone:{threshold}`, so the `UNIQUE (user_id, dedupe_key)` constraint
  (§13.2) makes "fire once" a database guarantee rather than application luck — and it stays correct
  across instances (register row 15c).
- Milestones are celebratory, so they are **in-app only, never push**. A push notification saying
  "50 hearts!" is the kind of thing that gets an app's notification permission revoked.
- Thresholds come from config, not code, in the `tripBlog` block alongside every other limit:

```yaml
# api-limits.yaml — tripBlog
  milestoneThresholds: [10, 50, 100, 500]
  milestoneToastsPerTripPerDay: 3
```

### 16.4 B14 Reaction Bursts — accessibility and a storm cap

- **`prefers-reduced-motion` is respected unconditionally.** With it set, the burst is replaced by an
  instant count change. This is not optional polish; an animation triggered by *other people's*
  actions is exactly the class of motion that causes harm.
- **Socket-triggered bursts are capped.** A popular photo receiving twenty reactions in ten seconds
  must not animate twenty times. Coalesce to at most one burst per target per 3 seconds, and never
  animate a target that is off-screen.
- The burst is purely local presentation. It reads the reaction event that B4 already delivers and
  adds no endpoint, no storage and no cost.

### 16.5 A12 Group Journaling Prompts — shares the nudge budget

A rotating, personally addressed prompt ("Sam, what was the best thing you ate today?") is a *nudge*
wearing different clothes. Left unmodelled, it becomes a second, uncapped notification channel that
quietly defeats FR-B6.1's 72-hour cap.

- A12 and B6 draw from **one shared per-user budget**. The cap is on nudges as a class, not per
  feature.
- Rotation state lives in a small table keyed `(trip_id, local_date)` recording which traveler was
  asked and which prompt was used, so the rotation is fair, does not repeat a prompt within a trip,
  and is idempotent under a re-run of the job (register 15a/15b again).
- Prompts are **suppressed for a day that already has content from that traveler** — asking someone
  to write about a day they already wrote about is the fastest way to train people to ignore the
  channel.
- Prompt text is a static, reviewed, localizable list. No generation, no cost, consistent with the
  Day Starter decision in §8.

### 16.6 Flags and gating for these five

| Flag | Gates | Fail-closed |
|---|---|---|
| `trip_blog_curation_stars` | B15 | Yes — it writes |
| `trip_blog_memory_lane` | B13 | **Yes** — it sends to followers |
| `trip_blog_milestones` | B16 | No — in-app presentation only |
| `trip_blog_reaction_bursts` | B14 | No — pure presentation |
| `trip_blog_group_prompts` | A12 | Yes — it notifies |

All default off. B13 additionally requires `notifications_push` and the per-category preference, so
turning it on cannot bypass a user's notification choices.
