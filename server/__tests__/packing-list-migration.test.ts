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

  it('collapses duplicate normalized labels before enforcing the new unique index, after backing up originals', () => {
    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/20260715_packing_lists_v2.sql'),
      'utf8'
    );
    expect(migrationSql).toMatch(/packing_lists_v2_dedup_map/i);
    expect(migrationSql).toMatch(/GROUP BY trip_id, normalized_label/i);
    expect(migrationSql).toMatch(/HAVING COUNT\(\*\) > 1/i);

    // Ordering matters: the backup tables must be populated (capturing every
    // pre-migration row, including the ones about to be merged away) before
    // the dedup step deletes anything, and the dedup step must run before
    // the unique index is created, or the CREATE UNIQUE INDEX would fail on
    // any pre-existing duplicate-label data.
    const backupInsertIndex = migrationSql.indexOf('INSERT INTO packing_lists_v2_trip_item_backup');
    const dedupDeleteIndex = migrationSql.indexOf('DELETE FROM trip_packing_list_items');
    const uniqueIndexIndex = migrationSql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_packing_v2_normalized_label');

    expect(backupInsertIndex).toBeGreaterThan(-1);
    expect(dedupDeleteIndex).toBeGreaterThan(-1);
    expect(uniqueIndexIndex).toBeGreaterThan(-1);
    expect(backupInsertIndex).toBeLessThan(dedupDeleteIndex);
    expect(dedupDeleteIndex).toBeLessThan(uniqueIndexIndex);
  });

  it('rollback restores backed-up rows instead of only dropping tables', () => {
    const rollbackSql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/20260715_packing_lists_v2.rollback.sql'),
      'utf8'
    );

    // The rollback must read from every backup table and INSERT the
    // original rows back before it drops the backup tables — otherwise
    // "rolling back" would just permanently delete the evidence instead of
    // restoring v1 state.
    expect(rollbackSql).toMatch(/INSERT INTO trip_packing_list_items[\s\S]*FROM packing_lists_v2_trip_item_backup/i);
    expect(rollbackSql).toMatch(/INSERT INTO trip_packing_item_checks[\s\S]*FROM packing_lists_v2_trip_check_backup/i);
    expect(rollbackSql).toMatch(/INSERT INTO user_packing_list_items[\s\S]*FROM packing_lists_v2_user_item_backup/i);
    expect(rollbackSql).toMatch(/ADD CONSTRAINT trip_packing_list_items_trip_id_category_label_key UNIQUE/i);
    // pg-mem (used in tests) does not support NOT EXISTS correlated
    // subqueries; the restore statements must use LEFT JOIN / IS NULL.
    expect(rollbackSql).not.toMatch(/NOT\s+EXISTS\s*\(/i);

    const restoreIndex = rollbackSql.indexOf('INSERT INTO trip_packing_list_items');
    const dropBackupIndex = rollbackSql.indexOf('DROP TABLE IF EXISTS packing_lists_v2_trip_item_backup');
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(dropBackupIndex).toBeGreaterThan(-1);
    expect(restoreIndex).toBeLessThan(dropBackupIndex);
  });
});
