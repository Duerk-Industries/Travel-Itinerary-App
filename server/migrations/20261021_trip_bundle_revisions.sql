CREATE TABLE IF NOT EXISTS planning_revisions (
  scope TEXT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0
);
