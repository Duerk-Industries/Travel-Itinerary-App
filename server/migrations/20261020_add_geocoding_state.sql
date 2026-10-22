-- Bounded public-POI jobs/cache and one cross-instance provider admission record.
CREATE TABLE IF NOT EXISTS geocoding_state (id TEXT PRIMARY KEY, payload JSONB NOT NULL);
INSERT INTO geocoding_state(id,payload) VALUES ('public-poi-v1','{"jobs":[],"nextAllowedAt":0}') ON CONFLICT(id) DO NOTHING;
