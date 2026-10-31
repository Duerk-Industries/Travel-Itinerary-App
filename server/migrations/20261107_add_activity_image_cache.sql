-- The picture found for an activity name (optionally within a city), looked up once and shared by every trip that has
-- an activity of that name. A row with no image_url records that nothing suitable was found, so the lookup is not
-- repeated on every page load; checked_at says when, so it can be tried again later.
CREATE TABLE IF NOT EXISTS activity_image_cache (
  cache_key TEXT PRIMARY KEY,
  image_url TEXT,
  credit TEXT,
  page_url TEXT,
  checked_at TIMESTAMP NOT NULL DEFAULT NOW()
);
