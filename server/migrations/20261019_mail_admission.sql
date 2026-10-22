-- Expand only. Seed changes intentionally do not overwrite deployed flags.
CREATE TABLE IF NOT EXISTS ingestion_aliases (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  data JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS ingestion_mail_receipts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ingestion_mail_receipts_owner ON ingestion_mail_receipts(user_id);
CREATE INDEX IF NOT EXISTS ingestion_mail_receipts_pending ON ingestion_mail_receipts((data->>'state'));
