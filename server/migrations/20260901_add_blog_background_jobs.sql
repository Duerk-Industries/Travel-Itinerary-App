-- Phase 6b: Background jobs infrastructure.

CREATE TABLE IF NOT EXISTS scheduled_job_leases (
  job_key TEXT PRIMARY KEY,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Memory Lane and Group Prompts jobs.
INSERT INTO scheduled_job_leases (job_key)
VALUES ('blog:memory_lane'), ('blog:group_prompts')
ON CONFLICT DO NOTHING;
