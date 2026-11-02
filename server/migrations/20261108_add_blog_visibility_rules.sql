-- R1. Existing accounts are test accounts: opt them in once, as explicitly requested.
-- The migration ledger prevents subsequent user privacy choices from being reset.
CREATE TABLE IF NOT EXISTS trip_blog_privacy_choices (
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opt_out BOOLEAN NOT NULL DEFAULT FALSE,
  opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, user_id)
);
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS early_release BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS r1_visibility_public BOOLEAN;
CREATE TABLE IF NOT EXISTS blog_visibility_transitions (
  id UUID PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  is_public BOOLEAN NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS blog_visibility_transitions_trip ON blog_visibility_transitions(trip_id, occurred_at);
UPDATE users SET blog_default_public = TRUE;
UPDATE trip_blogs SET public_opt_out = FALSE;
