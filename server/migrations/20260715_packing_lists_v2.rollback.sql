-- Restore every v1 row the forward migration touched (duplicate-collapse
-- deletions, packed-check remapping, and the "untouched universal copy"
-- user-list cleanup) before removing the v2-only schema, so rolling back
-- does not silently lose data that existed prior to this migration.

-- Note: LEFT JOIN / IS NULL is used instead of NOT EXISTS/correlated
-- subqueries throughout this file — pg-mem (the in-memory adapter used in
-- tests) does not support NOT EXISTS subqueries, and this SQL must run
-- against both real Postgres and pg-mem.
INSERT INTO trip_packing_list_items (id, trip_id, category, label, position, source_user_id, created_at, updated_at)
SELECT backup.original_id, backup.trip_id, backup.category, backup.label, backup.position, backup.source_user_id, backup.backed_up_at, backup.backed_up_at
FROM packing_lists_v2_trip_item_backup backup
LEFT JOIN trip_packing_list_items item ON item.id = backup.original_id
WHERE item.id IS NULL;

INSERT INTO trip_packing_item_checks (item_id, traveler_id, packed, updated_at)
SELECT backup.item_id, backup.traveler_id, backup.packed, backup.updated_at
FROM packing_lists_v2_trip_check_backup backup
LEFT JOIN trip_packing_item_checks chk
  ON chk.item_id = backup.item_id AND chk.traveler_id = backup.traveler_id
WHERE chk.item_id IS NULL;

INSERT INTO user_packing_list_items (id, user_id, category, label, position)
SELECT backup.original_id, backup.user_id, backup.category, backup.label, backup.position
FROM packing_lists_v2_user_item_backup backup
LEFT JOIN user_packing_list_items item ON item.id = backup.original_id
WHERE item.id IS NULL;

-- Re-add the legacy uniqueness rule the forward migration dropped. This is
-- safe now: every row restored above satisfies it by construction, since it
-- held for the exact same data before the forward migration ever ran.
ALTER TABLE trip_packing_list_items
  ADD CONSTRAINT trip_packing_list_items_trip_id_category_label_key UNIQUE (trip_id, category, label);

DROP INDEX IF EXISTS idx_trip_packing_v2_normalized_label;

ALTER TABLE trip_packing_list_items DROP COLUMN IF EXISTS normalized_label;
ALTER TABLE trip_packing_list_items DROP COLUMN IF EXISTS winning_source_id;
ALTER TABLE trip_packing_list_items DROP COLUMN IF EXISTS source_category;
ALTER TABLE trip_packing_list_items DROP COLUMN IF EXISTS source_position;
ALTER TABLE user_packing_list_items DROP COLUMN IF EXISTS normalized_label;

DROP TABLE IF EXISTS trip_packing_item_sources;
DROP TABLE IF EXISTS trip_packing_contributions;
DROP TABLE IF EXISTS user_packing_list_preferences;
DROP TABLE IF EXISTS preset_packing_list_items;
DROP TABLE IF EXISTS preset_packing_lists;
DROP TABLE IF EXISTS packing_lists_v2_dedup_map;
DROP TABLE IF EXISTS packing_lists_v2_trip_check_backup;
DROP TABLE IF EXISTS packing_lists_v2_trip_item_backup;
DROP TABLE IF EXISTS packing_lists_v2_user_item_backup;
