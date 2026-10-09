-- Phase 7 (analytics decision 5): IANA time zone of the trip's destination, derived offline from the
-- first transfer's arrival airport coordinates. Used to classify analytics events before/during/after a trip.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS timezone TEXT;
