-- Optional public-POI work is rebuildable; disable the geocoder before rollback.
DROP TABLE IF EXISTS geocoding_state;
