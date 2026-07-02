-- Manual rollback for 20260216_add_trip_activity.sql.

DROP INDEX IF EXISTS idx_trip_activity_trip_created;
DROP TABLE IF EXISTS trip_activity;
