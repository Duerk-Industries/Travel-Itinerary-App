-- Optional labels for notes and individual media assets. JSONB mirrors Firestore string arrays.
ALTER TABLE blog_items ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE blog_media_assets ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_blog_items_tags ON blog_items USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_blog_media_assets_tags ON blog_media_assets USING GIN (tags);
