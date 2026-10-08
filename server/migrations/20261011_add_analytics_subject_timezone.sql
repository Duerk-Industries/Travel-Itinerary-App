-- Phase 6: last device time zone seen for a pseudonym, so server-side outcome events can
-- apply the rollout's region exclusion (they carry no device zone of their own).
ALTER TABLE analytics_subjects ADD COLUMN IF NOT EXISTS last_device_timezone TEXT;
