-- The person's own choice about adding matching bookings to trips automatically.
-- NULL (or no row) means "never chose": the release default applies, so changing the default later needs no data change.
CREATE TABLE IF NOT EXISTS ingestion_user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_assign BOOLEAN,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
