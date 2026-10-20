-- Trip-level opt-in for showing followers an approximate day map built from photo geotags
-- (gap-closing plan section 1.3). Off by default and fail-closed: a missing trip_blogs row or
-- document reads as off. Travelers always see their own exact points; this governs only what
-- non-travelers receive, and what they receive is coarse (see blogMapProjection.ts).
ALTER TABLE trip_blogs ADD COLUMN IF NOT EXISTS shared_map_enabled BOOLEAN NOT NULL DEFAULT FALSE;
