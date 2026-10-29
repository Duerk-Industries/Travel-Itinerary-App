-- Optional uneven split of an expense among the travelers it is for: a map of member id to a
-- positive weight (1 = one share, 2 = a double portion). NULL means an equal split among for_ids,
-- which is every expense that existed before this column.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS for_shares JSONB;
