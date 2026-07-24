CREATE TABLE IF NOT EXISTS blog_publication_epochs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending_consent','public','revoked','expired')),
  requested_by UUID NOT NULL REFERENCES users(id),
  revoked_by UUID REFERENCES users(id),
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, epoch)
);
CREATE TABLE IF NOT EXISTS blog_publication_consents (
  epoch_id UUID NOT NULL REFERENCES blog_publication_epochs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('pending','approved','declined')),
  decided_at TIMESTAMP,
  PRIMARY KEY (epoch_id, user_id)
);
CREATE TABLE IF NOT EXISTS blog_public_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username_slug TEXT NOT NULL,
  trip_slug TEXT NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT FALSE,
  redirect_until TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (username_slug, trip_slug)
);
CREATE INDEX IF NOT EXISTS idx_blog_public_epochs_trip ON blog_publication_epochs(trip_id, epoch DESC);
