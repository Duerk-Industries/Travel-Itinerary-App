-- Retired worker: closes admission for older revisions sharing this database.
-- Stored objects/rows are removed only by the separately reviewed retirement manifest.
UPDATE feature_flags SET enabled = FALSE WHERE key = 'trip_blog_day_map_render';
