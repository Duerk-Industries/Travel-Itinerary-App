-- How an account's 16+ age was confirmed: 'self_declared_dob' (date-of-birth prompt)
-- or 'apple_declared_age_range' (Apple Declared Age Range API, no birthdate stored).
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verification_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified_at TIMESTAMPTZ;
