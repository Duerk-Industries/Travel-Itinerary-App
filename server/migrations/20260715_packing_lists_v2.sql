-- Packing lists v2: catalog, profile preferences, provenance, and canonical
-- trip items. The legacy packing tables remain readable during rollout.

CREATE TABLE IF NOT EXISTS preset_packing_lists (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  gendered BOOLEAN NOT NULL DEFAULT FALSE,
  content_hash TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS preset_packing_list_items (
  id UUID PRIMARY KEY,
  preset_id UUID NOT NULL REFERENCES preset_packing_lists(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (preset_id, normalized_label)
);

CREATE TABLE IF NOT EXISTS user_packing_list_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preset_keys JSONB NOT NULL DEFAULT '["general"]'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trip_packing_contributions (
  id UUID PRIMARY KEY,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('profile_preset', 'profile_personal', 'trip_preset', 'trip_manual', 'legacy_manual')),
  source_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source_preset_key TEXT,
  contribution_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trip_packing_item_sources (
  id UUID PRIMARY KEY,
  trip_item_id UUID NOT NULL REFERENCES trip_packing_list_items(id) ON DELETE CASCADE,
  contribution_id UUID NOT NULL REFERENCES trip_packing_contributions(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (trip_item_id, contribution_id)
);

ALTER TABLE trip_packing_list_items ADD COLUMN IF NOT EXISTS normalized_label TEXT;
ALTER TABLE trip_packing_list_items ADD COLUMN IF NOT EXISTS winning_source_id UUID;
ALTER TABLE trip_packing_list_items ADD COLUMN IF NOT EXISTS source_category TEXT;
ALTER TABLE trip_packing_list_items ADD COLUMN IF NOT EXISTS source_position INTEGER;
ALTER TABLE user_packing_list_items ADD COLUMN IF NOT EXISTS normalized_label TEXT;

-- Replace the legacy category/label constraint with canonical normalized-label
-- uniqueness. This is the one forward migration allowed to remove a legacy
-- constraint; the companion rollback is intentionally separate.
ALTER TABLE trip_packing_list_items DROP CONSTRAINT IF EXISTS trip_packing_list_items_trip_id_category_label_key;

UPDATE trip_packing_list_items
SET normalized_label = LOWER(TRIM(label))
WHERE normalized_label IS NULL;
UPDATE user_packing_list_items
SET normalized_label = LOWER(TRIM(label))
WHERE normalized_label IS NULL;

-- Durable migration evidence. These tables intentionally have no foreign
-- keys so a failed backfill never destroys the original v1 records. They
-- are populated BEFORE the duplicate-collapse step below so every row that
-- existed pre-migration — including rows about to be merged away — can be
-- restored exactly by the companion rollback.
CREATE TABLE IF NOT EXISTS packing_lists_v2_user_item_backup (
  backup_id UUID PRIMARY KEY,
  original_id UUID NOT NULL,
  user_id UUID NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  backed_up_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (original_id)
);

CREATE TABLE IF NOT EXISTS packing_lists_v2_trip_item_backup (
  backup_id UUID PRIMARY KEY,
  original_id UUID NOT NULL,
  trip_id UUID NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  source_user_id UUID,
  backed_up_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (original_id)
);

CREATE TABLE IF NOT EXISTS packing_lists_v2_trip_check_backup (
  backup_id UUID PRIMARY KEY,
  item_id UUID NOT NULL,
  traveler_id UUID NOT NULL,
  packed BOOLEAN NOT NULL,
  updated_at TIMESTAMP,
  backed_up_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, traveler_id)
);

INSERT INTO packing_lists_v2_user_item_backup (backup_id, original_id, user_id, category, label, position)
SELECT uuid_generate_v4(), id, user_id, category, label, position FROM user_packing_list_items
ON CONFLICT (original_id) DO NOTHING;
INSERT INTO packing_lists_v2_trip_item_backup (backup_id, original_id, trip_id, category, label, position, source_user_id)
SELECT uuid_generate_v4(), id, trip_id, category, label, position, source_user_id FROM trip_packing_list_items
ON CONFLICT (original_id) DO NOTHING;
INSERT INTO packing_lists_v2_trip_check_backup (backup_id, item_id, traveler_id, packed, updated_at)
SELECT uuid_generate_v4(), item_id, traveler_id, packed, updated_at FROM trip_packing_item_checks
ON CONFLICT (item_id, traveler_id) DO NOTHING;

-- Collapse pre-existing rows that share a (trip_id, normalized_label) but
-- differ in exact category/label casing/whitespace (e.g. "Sunscreen" vs
-- "sunscreen "). The v1 uniqueness rule allowed these to coexist; the new
-- normalized-label uniqueness rule below does not, so the CREATE UNIQUE
-- INDEX a few statements down would otherwise fail on any pre-existing trip
-- with such a collision. One row per group (the lowest id) is kept as
-- canonical; its provenance/packed-state is merged from the rows being
-- removed, none of which lose data since the backup tables above already
-- captured every original row.
CREATE TABLE IF NOT EXISTS packing_lists_v2_dedup_map (
  duplicate_id UUID PRIMARY KEY,
  canonical_id UUID NOT NULL
);

INSERT INTO packing_lists_v2_dedup_map (duplicate_id, canonical_id)
SELECT item.id, canonical.canonical_id
FROM trip_packing_list_items item
JOIN (
  SELECT trip_id, normalized_label, MIN(id::text)::uuid AS canonical_id
  FROM trip_packing_list_items
  WHERE normalized_label IS NOT NULL
  GROUP BY trip_id, normalized_label
  HAVING COUNT(*) > 1
) canonical
  ON canonical.trip_id = item.trip_id AND canonical.normalized_label = item.normalized_label
WHERE item.id <> canonical.canonical_id
ON CONFLICT (duplicate_id) DO NOTHING;

INSERT INTO trip_packing_item_sources (id, trip_item_id, contribution_id)
SELECT uuid_generate_v4(), dedup.canonical_id, s.contribution_id
FROM trip_packing_item_sources s
JOIN packing_lists_v2_dedup_map dedup ON dedup.duplicate_id = s.trip_item_id
ON CONFLICT (trip_item_id, contribution_id) DO NOTHING;

INSERT INTO trip_packing_item_checks (item_id, traveler_id, packed, updated_at)
SELECT dedup.canonical_id, c.traveler_id, c.packed, c.updated_at
FROM trip_packing_item_checks c
JOIN packing_lists_v2_dedup_map dedup ON dedup.duplicate_id = c.item_id
ON CONFLICT (item_id, traveler_id) DO NOTHING;

DELETE FROM trip_packing_list_items
WHERE id IN (SELECT duplicate_id FROM packing_lists_v2_dedup_map);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_packing_v2_normalized_label
  ON trip_packing_list_items (trip_id, normalized_label)
  WHERE normalized_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_preset_packing_lists_active ON preset_packing_lists (is_active, key);
CREATE INDEX IF NOT EXISTS idx_preset_packing_items_preset ON preset_packing_list_items (preset_id, position);
CREATE INDEX IF NOT EXISTS idx_trip_packing_contributions_trip ON trip_packing_contributions (trip_id, removed_at);
CREATE INDEX IF NOT EXISTS idx_trip_packing_sources_contribution ON trip_packing_item_sources (contribution_id);

INSERT INTO trip_packing_contributions (id, trip_id, source_kind, source_user_id, contribution_key)
SELECT uuid_generate_v4(), trip_id, 'profile_personal', source_user_id, trip_id::text || ':profile_personal:' || source_user_id::text
FROM trip_packing_list_items
WHERE source_user_id IS NOT NULL
GROUP BY trip_id, source_user_id
ON CONFLICT (contribution_key) DO NOTHING;
INSERT INTO trip_packing_contributions (id, trip_id, source_kind, contribution_key)
SELECT uuid_generate_v4(), trip_id, 'legacy_manual', trip_id::text || ':legacy_manual'
FROM trip_packing_list_items
WHERE source_user_id IS NULL
GROUP BY trip_id
ON CONFLICT (contribution_key) DO NOTHING;
INSERT INTO trip_packing_item_sources (id, trip_item_id, contribution_id)
SELECT uuid_generate_v4(), item.id, contribution.id
FROM trip_packing_list_items item
JOIN trip_packing_contributions contribution ON contribution.trip_id = item.trip_id
  AND ((item.source_user_id IS NULL AND contribution.source_kind = 'legacy_manual')
    OR (item.source_user_id IS NOT NULL AND contribution.source_kind = 'profile_personal' AND contribution.source_user_id = item.source_user_id))
ON CONFLICT (trip_item_id, contribution_id) DO NOTHING;

-- Existing users always retain General. If their old list was an untouched
-- copy of the universal defaults, convert it to an empty personal list;
-- edited/custom rows remain intact and are represented as personal items.
INSERT INTO user_packing_list_preferences (user_id, preset_keys)
SELECT id, '["general"]'::jsonb FROM users
ON CONFLICT (user_id) DO NOTHING;

DELETE FROM user_packing_list_items
WHERE user_id IN (
  SELECT candidate.user_id
  FROM user_packing_list_items candidate
  GROUP BY candidate.user_id
  HAVING COUNT(*) > 0
     AND COUNT(*) = (
       SELECT COUNT(*)
       FROM user_packing_list_items candidate_item
       WHERE candidate_item.user_id = candidate.user_id
         AND EXISTS (
           SELECT 1 FROM universal_packing_list_items universal_item
           WHERE LOWER(TRIM(universal_item.category)) = LOWER(TRIM(candidate_item.category))
             AND LOWER(TRIM(universal_item.label)) = LOWER(TRIM(candidate_item.label))
         )
     )
);
