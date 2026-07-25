CREATE TABLE IF NOT EXISTS blog_video_processing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL UNIQUE REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','completed','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  processing_seconds NUMERIC NOT NULL DEFAULT 0,
  input_bytes BIGINT NOT NULL DEFAULT 0,
  output_bytes BIGINT NOT NULL DEFAULT 0,
  error_code TEXT,
  available_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blog_video_jobs_ready ON blog_video_processing_jobs(state, available_at);
