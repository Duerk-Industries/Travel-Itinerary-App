ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS indexing_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_trip_blogs_indexing ON trip_blogs(indexing_enabled, updated_at DESC);
