CREATE TABLE IF NOT EXISTS blog_import_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_photos','apple_photos')),
  encrypted_token TEXT,
  provider_account_ref TEXT,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);
CREATE TABLE IF NOT EXISTS blog_import_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  album_ref TEXT,
  cursor TEXT,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed','expired')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  unassigned_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blog_import_jobs_user ON blog_import_jobs(user_id, created_at DESC);
