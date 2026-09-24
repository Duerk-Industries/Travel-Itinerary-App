-- Phase 2 of docs/trip-blog-social-implementation-plan.md — the remaining authoring-adjacent
-- schema from docs/trip-blog-social-architecture.md §3.3. `blog_days.update_version` is not
-- repeated here — it already landed in Phase 1's 20260901_add_blog_day_update_version.sql.

-- A1: per-user, per-day dismissal of the Day Starter suggestion (FR-A1.3). Not built in this
-- phase (Phase 5) — the column lands now so the schema is settled ahead of that route.
CREATE TABLE IF NOT EXISTS blog_day_starter_dismissals (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, local_date, user_id)
);

-- PR-3: photo geotags are off per trip until a traveler turns them on. Enabling is not
-- retroactive — see architecture §3.3.
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS photo_location_enabled BOOLEAN NOT NULL DEFAULT FALSE;
-- Owner kill-switch for follower commenting (PRD §8 decision 1). Read by
-- blogEngagementService.resolveEngagementTarget's trip-level-toggle step (architecture §4 step 5)
-- as soon as follower comment creation exists, even though the comment routes themselves are
-- Phase 4.
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS follower_comments_enabled BOOLEAN NOT NULL DEFAULT TRUE;
-- Bumped on every engagement write; the recap cache key (architecture §7.2) is
-- (tripId, contentRevision, engagementRevision, audienceClass) — content and engagement
-- invalidate the cached recap independently of each other.
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS engagement_revision BIGINT NOT NULL DEFAULT 0;

-- C2: geotags captured from EXIF at upload. Nullable — most photos will not have them, and the
-- columns must be absent from every public projection. `is_decorative` supports FR-A8.4 (a
-- traveler may mark an image decorative instead of supplying alt text).
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS captured_lat NUMERIC;
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS captured_lng NUMERIC;
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS is_decorative BOOLEAN NOT NULL DEFAULT FALSE;

-- B11.3: three hides on a trip ends commenting there for that user. Read (not yet written to,
-- since hiding is a Phase 3/4 moderation-endpoint concern) by resolveEngagementTarget's strike
-- check (architecture §4 step 6).
CREATE TABLE IF NOT EXISTS blog_comment_strikes (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strike_count INTEGER NOT NULL DEFAULT 0,
  blocked_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, user_id)
);

-- C7: shared recap cache/lease; avoids duplicate cross-instance aggregation (architecture §7.2).
-- Not populated until Phase 6, but the schema is part of this phase's engagement-adjacent set.
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
