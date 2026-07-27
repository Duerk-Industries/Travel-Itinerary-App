ALTER TABLE itinerary_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS blog_item_source_links (
  item_id UUID PRIMARY KEY REFERENCES blog_items(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('itinerary_detail')),
  source_id UUID NOT NULL,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  detached BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_blog_source_links_source ON blog_item_source_links(source_type, source_id);
