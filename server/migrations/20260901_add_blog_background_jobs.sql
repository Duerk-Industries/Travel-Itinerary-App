-- Phase 6b: Background jobs infrastructure.

CREATE TABLE IF NOT EXISTS scheduled_job_leases (
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
INSERT INTO scheduled_job_leases (job_key)
VALUES ('blog:memory_lane'), ('blog:group_prompts'), ('blog:day_map_render')
ON CONFLICT DO NOTHING;
