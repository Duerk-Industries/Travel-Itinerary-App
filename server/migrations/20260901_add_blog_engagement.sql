-- Phase 2 of docs/trip-blog-social-implementation-plan.md — the engagement spine. Ships dark: no
-- routes attach to this schema in this phase. See docs/trip-blog-social-architecture.md §3.2.

-- 3.1: reactions and comments both attach to one of three things — a day, an item, or a media
-- asset. One nullable-column target with a check constraint enforcing exactly one, rather than
-- three parallel table sets. Real FK columns (not a (target_kind, target_id) string pair) so
-- cascade-on-delete is enforced by the database: when a gallery item or an asset is deleted, its
-- engagement goes with it, with no application code required to remember that.
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
  CHECK (
    (target_kind = 'day'   AND blog_day_id  IS NOT NULL AND blog_item_id IS NULL AND asset_id IS NULL) OR
    (target_kind = 'item'  AND blog_item_id IS NOT NULL AND blog_day_id  IS NULL AND asset_id IS NULL) OR
    (target_kind = 'asset' AND asset_id     IS NOT NULL AND blog_day_id  IS NULL AND blog_item_id IS NULL)
  )
);

-- One reaction per user per target. Partial unique indexes, one per kind, because the target
-- columns are nullable and a plain composite unique would allow duplicates on NULLs.
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
  -- Nullable so account deletion can scrub the body/author link while leaving a tombstone for
  -- replies (PR-6) — see FR-B2.4's tombstone rule and the note below.
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Snapshotted, not resolved at read time: a follower can later be promoted to a traveler or
  -- removed from the trip, and the comment should keep rendering with the role it was written
  -- under. This also means the read path never needs a membership join per comment.
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
  CHECK (
    (target_kind = 'day'   AND blog_day_id  IS NOT NULL AND blog_item_id IS NULL AND asset_id IS NULL) OR
    (target_kind = 'item'  AND blog_item_id IS NOT NULL AND blog_day_id  IS NULL AND asset_id IS NULL) OR
    (target_kind = 'asset' AND asset_id     IS NOT NULL AND blog_day_id  IS NULL AND blog_item_id IS NULL)
  ),
  -- A live comment always has a body; a soft-deleted one always has none — the database-level
  -- half of FR-B2.4's tombstone rule. The 1–2000 char length bound itself is enforced in
  -- postgresEngagementRepository.ts, not here: pg-mem's native function set has neither
  -- `char_length` nor `length` (confirmed empirically — see the pg-mem compatibility note in
  -- architecture §3.4), and the existing blog_text_contents.body column already keeps its own
  -- 100,000-char cap in application code rather than a DB CHECK, so this follows precedent rather
  -- than registering a custom pg-mem function for one constraint.
  CHECK ((deleted_at IS NULL AND body IS NOT NULL) OR (deleted_at IS NOT NULL AND body IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_blog_comments_day    ON blog_comments(blog_day_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_blog_comments_parent ON blog_comments(parent_comment_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_blog_comments_trip   ON blog_comments(trip_id, created_at);

-- Denormalized counters — the source of truth for every count the read path renders (NFR-1).
-- One row per (target, audience), not merely per target: an authorized traveler sums all
-- audiences they may see; a follower sums followers+public; an anonymous reader gets public only.
-- target_id is deliberately NOT a foreign key — it is polymorphic across three parents, and a
-- counter row is disposable derived data reaped by the reconciliation job, not application code.
CREATE TABLE IF NOT EXISTS blog_engagement_counters (
  target_kind TEXT NOT NULL CHECK (target_kind IN ('day','item','asset')),
  target_id UUID NOT NULL,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('travelers','followers','public')),
  reaction_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
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

-- Generic DB-backed claim/lease primitive, needed now for the counter-reconciliation job below
-- and reusable as-is by the notification outbox and recap-snapshot leasing in later phases
-- (Phase 0's "DB lease primitive" prerequisite, not built in Phase 1 — built here instead, scoped
-- narrowly rather than as a speculative framework). A unique (job_key, window_start) row is the
-- lease: claiming is an INSERT that either succeeds or hits the unique constraint, which is
-- atomic on every adapter without needing SELECT ... FOR UPDATE SKIP LOCKED semantics pg-mem
-- doesn't reliably support.
CREATE TABLE IF NOT EXISTS scheduled_job_leases (
  job_key TEXT NOT NULL,
  window_start TIMESTAMP NOT NULL,
  lease_owner TEXT NOT NULL,
  claimed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  PRIMARY KEY (job_key, window_start)
);
