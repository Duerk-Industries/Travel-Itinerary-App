-- Phase 4 (docs/implementation-plans/analytics-upgrade.md): rights handling and retention.
-- Subjects are identified by an HMAC of the account ID (subject_hash), so these
-- records survive account deletion without keeping the raw ID.

-- Erasure markers: block late writes (queued events, async settlements) from
-- re-linking data to an erased subject. scope = 'analytics' | 'account'.
CREATE TABLE IF NOT EXISTS erasure_tombstones (
  subject_hash TEXT NOT NULL,
  scope        TEXT NOT NULL,
  erased_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (subject_hash, scope)
);

-- Durable, retryable erasure jobs. user_id is cleared once the job completes.
CREATE TABLE IF NOT EXISTS privacy_erasure_jobs (
  id            TEXT PRIMARY KEY,
  subject_hash  TEXT NOT NULL,
  user_id       TEXT,
  scope         TEXT NOT NULL,
  status        TEXT NOT NULL,
  steps         TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  requested_by  TEXT NOT NULL,
  requested_at  TIMESTAMPTZ NOT NULL,
  due_at        TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_privacy_erasure_jobs_status ON privacy_erasure_jobs(status);
CREATE INDEX IF NOT EXISTS idx_privacy_erasure_jobs_subject ON privacy_erasure_jobs(subject_hash);

-- Manually received rights requests (email/web) with statutory deadlines.
CREATE TABLE IF NOT EXISTS privacy_rights_requests (
  id            TEXT PRIMARY KEY,
  request_type  TEXT NOT NULL,
  jurisdiction  TEXT NOT NULL,
  channel       TEXT NOT NULL,
  status        TEXT NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL,
  due_at        TIMESTAMPTZ NOT NULL,
  extended      BOOLEAN NOT NULL DEFAULT FALSE,
  subject_hash  TEXT,
  notes         TEXT,
  created_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL,
  closed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_privacy_rights_requests_status ON privacy_rights_requests(status, due_at);

-- Minimal consent evidence kept after account deletion (account lifetime + 3 years).
CREATE TABLE IF NOT EXISTS privacy_consent_evidence_archive (
  id             TEXT PRIMARY KEY,
  subject_hash   TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  granted        BOOLEAN NOT NULL,
  epoch          INTEGER NOT NULL,
  notice_version TEXT NOT NULL,
  platform       TEXT NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  archived_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_privacy_consent_archive_archived ON privacy_consent_evidence_archive(archived_at);
