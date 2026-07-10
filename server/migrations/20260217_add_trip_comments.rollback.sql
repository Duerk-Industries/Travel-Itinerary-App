-- Manual rollback for 20260217_add_trip_comments.sql.

DROP INDEX IF EXISTS idx_trip_comments_trip_created;
DROP TABLE IF EXISTS trip_comments;
