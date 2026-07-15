/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

describe('packing list migrations', () => {
  it('updates existing users with an append-only packing-list migration', () => {
    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/20260514_update_existing_user_packing_lists.sql'),
      'utf8'
    );

    expect(migrationSql).toMatch(/INSERT INTO user_packing_list_items/i);
    expect(migrationSql).toMatch(/FROM users/i);
    expect(migrationSql).toMatch(/universal_packing_list_items/i);
    expect(migrationSql).toMatch(/ON CONFLICT \(user_id, category, label\) DO NOTHING/i);
    expect(migrationSql).not.toMatch(/\bUPDATE\s+users\b/i);
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\s+users\b/i);
    expect(migrationSql).not.toMatch(/\bUPDATE\s+user_packing_list_items\b/i);
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\s+user_packing_list_items\b/i);
  });

  it('backs up legacy rows, seeds General preferences, and preserves provenance during v2 conversion', () => {
    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/20260715_packing_lists_v2.sql'),
      'utf8'
    );
    expect(migrationSql).toMatch(/packing_lists_v2_user_item_backup/i);
    expect(migrationSql).toMatch(/packing_lists_v2_trip_item_backup/i);
    expect(migrationSql).toMatch(/packing_lists_v2_trip_check_backup/i);
    expect(migrationSql).toMatch(/preset_keys JSONB.*general/i);
    expect(migrationSql).toMatch(/legacy_manual/i);
    expect(migrationSql).toMatch(/profile_personal/i);
    expect(migrationSql).toMatch(/DELETE FROM user_packing_list_items/i);
    expect(migrationSql).toMatch(/DROP CONSTRAINT IF EXISTS trip_packing_list_items_trip_id_category_label_key/i);
  });
});
