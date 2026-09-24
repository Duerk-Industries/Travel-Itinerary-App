-- Phase 4.5 of docs/trip-blog-social-implementation-plan.md — Notification service
-- (app-wide infrastructure). See docs/trip-blog-social-architecture.md §13.2.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,          -- 'blog_mention','blog_comment_reply','blog_nudge','blog_reaction_digest'
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT,                  -- in-app route, e.g. trip/:id/blog?day=2026-05-14#comment-:id
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMP,
  seen_at TIMESTAMP,               -- surfaced in the inbox, vs. actually opened
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  dedupe_key TEXT,                 -- collapse duplicates: one row per logical event per user
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, created_at) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  push_token_ciphertext TEXT NOT NULL,
  push_token_hash TEXT NOT NULL,
  device_label TEXT,
  permission_state TEXT NOT NULL DEFAULT 'granted'
    CHECK (permission_state IN ('granted','denied','undetermined','revoked')),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  failure_count INTEGER NOT NULL DEFAULT 0,
  disabled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, push_token_hash)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  in_app BOOLEAN NOT NULL DEFAULT TRUE,
  push BOOLEAN NOT NULL DEFAULT TRUE,
  email BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS notification_thread_mutes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, thread_key)
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('push','email')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','sent','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMP,
  last_error_code TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (notification_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_claim
  ON notification_outbox(state, next_attempt_at, created_at);
