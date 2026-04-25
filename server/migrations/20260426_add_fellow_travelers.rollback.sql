-- Manual rollback for 20260426_add_fellow_travelers.sql.
DROP INDEX IF EXISTS idx_fellow_travelers_owner_name;
DROP TABLE IF EXISTS fellow_travelers;
