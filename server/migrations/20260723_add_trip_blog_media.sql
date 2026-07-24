CREATE TABLE IF NOT EXISTS blog_storage_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  included_bytes BIGINT NOT NULL DEFAULT 0,
  purchased_bytes BIGINT NOT NULL DEFAULT 0,
  reserved_bytes BIGINT NOT NULL DEFAULT 0,
  visible_committed_bytes BIGINT NOT NULL DEFAULT 0,
  grace_hidden_bytes BIGINT NOT NULL DEFAULT 0,
  entitlement_active BOOLEAN NOT NULL DEFAULT TRUE,
  grace_started_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_storage_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes > 0),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'committed', 'released', 'expired')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS blog_media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  uploader_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_account_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_kind_key TEXT NOT NULL CHECK (media_kind_key IN ('photo', 'video', 'audio', 'panorama')),
  source TEXT NOT NULL DEFAULT 'upload',
  source_ref TEXT,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'uploading', 'quarantined', 'processing', 'ready', 'grace_hidden', 'rejected', 'failed', 'deleted')),
  pipeline_version INTEGER NOT NULL DEFAULT 1,
  object_generation TEXT,
  object_key TEXT,
  primary_rendition_id UUID,
  poster_rendition_id UUID,
  physical_bytes BIGINT NOT NULL DEFAULT 0,
  billable_bytes BIGINT NOT NULL DEFAULT 0,
  source_checksum TEXT,
  source_mime_type TEXT,
  captured_at TIMESTAMP,
  capture_timezone TEXT,
  caption TEXT,
  alt_text TEXT,
  credit TEXT,
  moderation_state TEXT NOT NULL DEFAULT 'pending',
  hidden_at TIMESTAMP,
  delete_after TIMESTAMP,
  failure_code TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blog_media_renditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  rendition_kind_key TEXT NOT NULL,
  object_key TEXT,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  frame_rate NUMERIC,
  duration_ms BIGINT,
  byte_size BIGINT NOT NULL DEFAULT 0,
  checksum TEXT,
  pipeline_version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'ready',
  language_tag TEXT,
  text_payload TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blog_item_assets (
  item_id UUID NOT NULL REFERENCES blog_items(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL UNIQUE REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'primary',
  PRIMARY KEY (item_id, asset_id)
);

CREATE TABLE IF NOT EXISTS blog_item_highlights (
  item_id UUID PRIMARY KEY REFERENCES blog_items(id) ON DELETE CASCADE,
  starred_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_storage_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES blog_media_assets(id) ON DELETE SET NULL,
  byte_delta BIGINT NOT NULL,
  rendition_kind_key TEXT,
  usage_state TEXT NOT NULL CHECK (usage_state IN ('visible', 'grace_hidden', 'deleted')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_media_retention_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES blog_media_assets(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('hide_over_limit', 'restore_capacity', 'delete_grace_expired')),
  delete_after TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (asset_id, action)
);

CREATE INDEX IF NOT EXISTS idx_blog_media_uploader_created ON blog_media_assets(storage_account_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_blog_media_trip_state ON blog_media_assets(trip_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_blog_media_retention_due ON blog_media_assets(delete_after) WHERE delete_after IS NOT NULL;
