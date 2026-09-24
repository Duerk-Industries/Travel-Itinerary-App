-- Phase 6b: Background jobs infrastructure (Memory Lane, Group Prompts, Day Map Render).
--
-- Renamed from the original `scheduled_job_leases` to `blog_worker_leases` during the Phases 0-7
-- audit: 20260901_add_blog_engagement.sql (Phase 2) already owns a table of that name, keyed
-- `(job_key, window_start)` for the counter-reconciliation job — see scheduledJobLease.ts's own
-- comment that it's "reusable as-is by ... later phases." Both migrations used
-- `CREATE TABLE IF NOT EXISTS`, so whichever ran first (alphabetically, this one, "background" <
-- "engagement") silently won and the other's CREATE TABLE became a no-op against an incompatible
-- shape — `scheduledJobLease.ts`'s INSERT expects a `window_start` column that no longer existed,
-- so every claimJobLease call failed and was swallowed by its own catch block as "already
-- claimed." This job type is a different, simpler lease shape (one row per job, an expiring lease
-- rather than a per-window claim) — it gets its own table name instead of colliding.
CREATE TABLE IF NOT EXISTS blog_worker_leases (
  job_key TEXT PRIMARY KEY,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_day_map_artifacts (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_date DATE NOT NULL,
  points_hash TEXT NOT NULL,
  gcs_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (trip_id, day_date, points_hash)
);

-- Seed Memory Lane, Group Prompts and Day Map Render jobs.
INSERT INTO blog_worker_leases (job_key)
VALUES ('blog:memory_lane'), ('blog:group_prompts'), ('blog:day_map_render')
ON CONFLICT DO NOTHING;
