-- Schedule or delete undated optional activities before rolling back.
ALTER TABLE tours ALTER COLUMN date SET NOT NULL;
ALTER TABLE tours DROP COLUMN IF EXISTS near_lodging_id;
