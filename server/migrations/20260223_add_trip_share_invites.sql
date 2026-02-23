CREATE TABLE IF NOT EXISTS trip_share_invites (
  id UUID PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  invitee_email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  token_hash TEXT,
  expires_at TIMESTAMP,
  accepted_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_share_invites_trip_id
  ON trip_share_invites(trip_id);

CREATE INDEX IF NOT EXISTS idx_trip_share_invites_email
  ON trip_share_invites(LOWER(invitee_email));

CREATE INDEX IF NOT EXISTS idx_trip_share_invites_status
  ON trip_share_invites(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_share_invites_pending_unique
  ON trip_share_invites(trip_id, LOWER(invitee_email), role)
  WHERE status = 'pending' AND revoked_at IS NULL;
