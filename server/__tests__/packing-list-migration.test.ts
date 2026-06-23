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
});
