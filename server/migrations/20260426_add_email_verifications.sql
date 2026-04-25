--
-- First-boot email verification tokens. Short-lived rows keyed by a token
-- hash; consumed on `/confirm` and then left in place (with `used_at`
-- stamped) for audit. Separate from `user_email_verifications`, which is
-- for adding secondary emails to an already-verified account.
--
-- Cut over from inline `CREATE TABLE IF NOT EXISTS` in db.postgres.ts to a
-- migration file under the Priority 10 "inline → migrations" program. The
-- drift-guard snapshot in migrationDriftGuard.test.ts no longer lists this
-- table. Rollback lives in the `.rollback.sql` companion.
CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  used_at TIMESTAMP
);
