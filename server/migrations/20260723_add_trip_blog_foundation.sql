CREATE TABLE IF NOT EXISTS trip_blogs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT,
  introduction TEXT,
  content_revision BIGINT NOT NULL DEFAULT 0,
  visibility_state TEXT NOT NULL DEFAULT 'private' CHECK (visibility_state IN ('private', 'pending_consent', 'public')),
  visibility_epoch BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_days (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  headline TEXT,
  summary TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, local_date)
);

CREATE TABLE IF NOT EXISTS blog_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  blog_day_id UUID REFERENCES blog_days(id) ON DELETE CASCADE,
  kind_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  audience TEXT NOT NULL DEFAULT 'public' CHECK (audience IN ('travelers', 'followers', 'public')),
  sort_key TEXT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_editor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  planned_activity_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_text_contents (
  item_id UUID PRIMARY KEY REFERENCES blog_items(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  language_tag TEXT,
  content_format TEXT NOT NULL DEFAULT 'plain_text' CHECK (content_format = 'plain_text')
);

CREATE TABLE IF NOT EXISTS blog_item_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES blog_items(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  editor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  change_kind TEXT NOT NULL,
  content_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, version)
);

CREATE INDEX IF NOT EXISTS idx_blog_days_trip_date ON blog_days(trip_id, local_date);
CREATE INDEX IF NOT EXISTS idx_blog_items_trip_day_sort ON blog_items(trip_id, blog_day_id, sort_key) WHERE deleted_at IS NULL;
