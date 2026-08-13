import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app';
import {
  closePool,
  initDb,
  createTripWithGroupAndMembers,
  getPackingListV2,
  getUserPackingListV2,
  poolClient,
  replaceUserPackingPreferencesV2,
  setFeatureFlag,
  syncPackingPresetCatalogV2,
} from '../src/db';
import { parsePackingPresetDirectory } from '../src/services/packingListCatalogService';
import { cleanupTestUsersByEmail, registerAndLoginWebUser, seedTiersForTest } from './helpers';

describe('packing lists v2', () => {
  const owner = { email: 'packing-v2-owner@example.com', firstName: 'V2', lastName: 'Owner', password: 'testtest' };
  let ownerId = '';
  let ownerToken = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await closePool();
    await initDb();
    const presets = parsePackingPresetDirectory();
    await syncPackingPresetCatalogV2(presets);
    await seedTiersForTest();
    await cleanupTestUsersByEmail([owner.email]);
    const login = await registerAndLoginWebUser(owner);
    ownerId = login.userId;
    ownerToken = login.token;
    await setFeatureFlag('packing_lists_v2', true, null);
  });

  afterAll(async () => {
    await closePool();
  });

  it('keeps General mandatory and permits an empty personal list', async () => {
    const result = await replaceUserPackingPreferencesV2(ownerId, ['women'], []);
    expect(result.preferences.presetKeys).toEqual(expect.arrayContaining(['general', 'women']));
    expect(await getUserPackingListV2(ownerId)).toEqual([]);
  });

  it('materializes a selected profile preset into personal items used by trips', async () => {
    await replaceUserPackingPreferencesV2(ownerId, ['general'], []);

    const added = await request(app)
      .post('/api/account/packing-list-presets/men')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(added.body.preferences.presetKeys).toEqual(['general']);
    expect(added.body.items.some((item: any) => item.label === 'Polo shirt')).toBe(true);

    const created = await createTripWithGroupAndMembers({ ownerId, tripName: 'Personal packing trip', members: [] });
    const trip = await getPackingListV2(ownerId, created.trip.id);
    expect(trip.groups.some((group) => group.items.some((item) => item.label === 'Polo shirt'))).toBe(true);
  });

  it('deletes one persisted profile packing item without restoring it', async () => {
    const saved = await replaceUserPackingPreferencesV2(ownerId, ['general'], [
      { category: 'Toiletries', label: 'Makeup remover' },
      { category: 'Accessories', label: 'Compact jewelry case' },
    ]);
    const itemToRemove = saved.items.find((item) => item.label === 'Makeup remover');
    expect(itemToRemove).toBeDefined();

    await request(app)
      .delete(`/api/account/packing-list/${itemToRemove!.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect((await getUserPackingListV2(ownerId)).some((item) => item.id === itemToRemove!.id)).toBe(false);
    expect((await getUserPackingListV2(ownerId)).some((item) => item.label === 'Compact jewelry case')).toBe(true);
  });

  it('composes profile presets and trip additions into ordered groups', async () => {
    await replaceUserPackingPreferencesV2(ownerId, ['general', 'hiking'], [{ category: 'Personal', label: 'Personal travel journal' }]);
    const created = await createTripWithGroupAndMembers({ ownerId, tripName: 'V2 trip', members: [] });
    const initial = await getPackingListV2(ownerId, created.trip.id);
    expect(initial.groups[0].label).toBe('Health & Toiletries');
    expect(initial.sources?.some((source) => source.label.toLowerCase().includes('hiking'))).toBe(true);
    expect(initial.sources?.some((source) => source.label.includes('Owner'))).toBe(true);

    const added = await request(app)
      .post(`/api/trips/${created.trip.id}/packing-list/presets`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ presetKey: 'beach' })
      .expect(200);
    expect(added.body.sources.some((source: any) => source.label.toLowerCase().includes('beach') && source.active)).toBe(true);
    const manual = await request(app)
      .put(`/api/trips/${created.trip.id}/packing-list`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ items: [{ category: 'Trip notes', label: 'Trip-only item' }] })
      .expect(200);
    expect(manual.body.groups.some((group: any) => group.items.some((item: any) => item.label === 'Trip-only item' && item.category === 'Trip notes'))).toBe(true);
  });

  it('retracts profile contributions when a member is removed', async () => {
    const friend = { email: 'packing-v2-friend@example.com', firstName: 'Friend', lastName: 'V2', password: 'testtest' };
    await cleanupTestUsersByEmail([friend.email]);
    const friendLogin = await registerAndLoginWebUser(friend);
    const friendId = friendLogin.userId;

    await replaceUserPackingPreferencesV2(friendId, ['general'], [{ category: 'Personal', label: 'Unique friend item' }]);

    const created = await createTripWithGroupAndMembers({
      ownerId,
      tripName: 'Sharing trip',
      members: [],
    });
    const tripId = created.trip.id;

    // Manually add friend as an active member (bypassing invite for test simplicity)
    const p = require('../src/db').poolClient();
    const memberId = require('crypto').randomUUID();
    await p.query(
      'INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $4)',
      [memberId, created.groupId, friendId, ownerId]
    );

    // Verify friend's item is present
    const initial = await getPackingListV2(ownerId, tripId);
    expect(initial.groups.some((g: any) => g.items.some((i: any) => i.label === 'Unique friend item'))).toBe(true);

    // Remove friend
    await request(app)
      .delete(`/api/account/trips/${tripId}/members/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Verify item is retracted
    const afterRemoval = await getPackingListV2(ownerId, tripId);
    expect(afterRemoval.groups.some((g: any) => g.items.some((i: any) => i.label === 'Unique friend item'))).toBe(false);
  });

  it('moves shared personal items to Multiple Travelers section', async () => {
    const alex = { email: 'alex@example.com', firstName: 'Alex', lastName: 'V2', password: 'testtest' };
    const bob = { email: 'bob@example.com', firstName: 'Bob', lastName: 'V2', password: 'testtest' };
    await cleanupTestUsersByEmail([alex.email, bob.email]);
    const alexLogin = await registerAndLoginWebUser(alex);
    const bobLogin = await registerAndLoginWebUser(bob);

    await replaceUserPackingPreferencesV2(alexLogin.userId, ['general'], [{ category: 'Personal', label: 'Shared Item' }]);
    await replaceUserPackingPreferencesV2(bobLogin.userId, ['general'], [{ category: 'Personal', label: 'Shared Item' }]);

    const created = await createTripWithGroupAndMembers({
      ownerId: alexLogin.userId,
      tripName: 'Shared items trip',
      members: [],
    });

    // Manually add bob as an active member
    const p = require('../src/db').poolClient();
    await p.query(
      'INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $4)',
      [require('crypto').randomUUID(), created.groupId, bobLogin.userId, alexLogin.userId]
    );

    const result = await getPackingListV2(alexLogin.userId, created.trip.id);
    const sharedGroup = result.groups.find((g: any) => g.kind === 'multiple_travelers');
    expect(sharedGroup).toBeDefined();
    expect(sharedGroup!.items.some((i: any) => i.label === 'Shared Item')).toBe(true);

    // Should not be in individual personal lists
    const alexGroup = result.groups.find((g: any) => g.kind === 'personal' && g.ownerMemberId === alexLogin.userId);
    const bobGroup = result.groups.find((g: any) => g.kind === 'personal' && g.ownerMemberId === bobLogin.userId);
    expect(alexGroup?.items.some((i: any) => i.label === 'Shared Item')).toBeFalsy();
    expect(bobGroup?.items.some((i: any) => i.label === 'Shared Item')).toBeFalsy();
  });

  it('rejects trip packing-list writes from a user who is not a trip member or follower', async () => {
    const outsider = { email: 'packing-v2-outsider@example.com', firstName: 'Out', lastName: 'Sider', password: 'testtest' };
    await cleanupTestUsersByEmail([outsider.email]);
    const outsiderLogin = await registerAndLoginWebUser(outsider);

    const created = await createTripWithGroupAndMembers({ ownerId, tripName: 'Locked-down trip', members: [] });
    const tripId = created.trip.id;
    const before = await getPackingListV2(ownerId, tripId);

    await request(app)
      .post(`/api/trips/${tripId}/packing-list/presets`)
      .set('Authorization', `Bearer ${outsiderLogin.token}`)
      .send({ presetKey: 'beach' })
      .expect(403);

    await request(app)
      .delete(`/api/trips/${tripId}/packing-list/presets/general`)
      .set('Authorization', `Bearer ${outsiderLogin.token}`)
      .expect(403);

    await request(app)
      .put(`/api/trips/${tripId}/packing-list`)
      .set('Authorization', `Bearer ${outsiderLogin.token}`)
      .send({ items: [{ category: 'Trip notes', label: 'Injected by outsider' }] })
      .expect(403);

    // The rejected requests must not have mutated the trip's packing data as a side effect.
    const after = await getPackingListV2(ownerId, tripId);
    expect(after.groups.some((g: any) => g.label.toLowerCase().includes('beach'))).toBe(false);
    expect(after.tripPresetKeys).toEqual(before.tripPresetKeys);
    expect(after.groups.some((g: any) => g.items.some((i: any) => i.label === 'Injected by outsider'))).toBe(false);
  });

  it('migration dedup step collapses pre-existing duplicate normalized labels without losing provenance', async () => {
    const p = poolClient();
    const created = await createTripWithGroupAndMembers({ ownerId, tripName: 'Dedup trip', members: [] });
    const tripId = created.trip.id;

    // Simulate the pre-migration (v1) state, where two rows for the same
    // trip could share a normalized label but differ in exact casing/
    // whitespace — something the (trip_id, normalized_label) unique index
    // now forbids. Drop it temporarily so the dirty rows can be inserted.
    await p.query('DROP INDEX IF EXISTS idx_trip_packing_v2_normalized_label');
    const keepId = randomUUID();
    const dropId = randomUUID();
    await p.query(
      `INSERT INTO trip_packing_list_items (id, trip_id, category, label, normalized_label, position)
       VALUES ($1, $2, 'General', 'Sunscreen', 'sunscreen', 0)`,
      [keepId, tripId]
    );
    await p.query(
      `INSERT INTO trip_packing_list_items (id, trip_id, category, label, normalized_label, position)
       VALUES ($1, $2, 'Beach', 'sunscreen ', 'sunscreen', 1)`,
      [dropId, tripId]
    );

    // Attach a contribution/source and a packed-check to the row that is
    // about to be collapsed away, to verify both are carried forward to the
    // surviving canonical row rather than silently dropped.
    const contributionId = randomUUID();
    await p.query(
      `INSERT INTO trip_packing_contributions (id, trip_id, source_kind, contribution_key) VALUES ($1, $2, 'trip_manual', $3)`,
      [contributionId, tripId, `${tripId}:dedup-test`]
    );
    await p.query(
      `INSERT INTO trip_packing_item_sources (id, trip_item_id, contribution_id) VALUES ($1, $2, $3)`,
      [randomUUID(), dropId, contributionId]
    );
    const memberRow: any = await p.query(`SELECT id FROM group_members WHERE group_id = $1 LIMIT 1`, [created.groupId]);
    const travelerId = memberRow.rows[0].id;
    await p.query(
      `INSERT INTO trip_packing_item_checks (item_id, traveler_id, packed) VALUES ($1, $2, TRUE)`,
      [dropId, travelerId]
    );

    // Re-run the same dedup-then-reindex SQL the forward migration runs,
    // exercising it directly against the dirty data seeded above.
    await p.query(`
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
    `);
    await p.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_packing_v2_normalized_label
       ON trip_packing_list_items (trip_id, normalized_label) WHERE normalized_label IS NOT NULL`
    );

    // Exactly one of the two dirty rows survives — the migration keeps the
    // lowest id, which is arbitrary from the test's point of view, so assert
    // on whichever one actually remains rather than assuming keepId "wins".
    const remaining: any = await p.query(
      `SELECT id FROM trip_packing_list_items WHERE trip_id = $1 AND normalized_label = 'sunscreen'`,
      [tripId]
    );
    expect(remaining.rows).toHaveLength(1);
    expect([keepId, dropId]).toContain(remaining.rows[0].id);
    const survivorId = remaining.rows[0].id;

    const sources: any = await p.query(`SELECT contribution_id FROM trip_packing_item_sources WHERE trip_item_id = $1`, [survivorId]);
    expect(sources.rows.some((r: any) => r.contribution_id === contributionId)).toBe(true);

    const checks: any = await p.query(
      `SELECT packed FROM trip_packing_item_checks WHERE item_id = $1 AND traveler_id = $2`,
      [survivorId, travelerId]
    );
    expect(checks.rows[0]?.packed).toBe(true);
  });

  it('rollback restores rows from the backup tables rather than only dropping them', async () => {
    const p = poolClient();
    const created = await createTripWithGroupAndMembers({ ownerId, tripName: 'Rollback restore trip', members: [] });
    const tripId = created.trip.id;

    // Simulate a row that existed pre-migration and was captured in the
    // backup table (in production this happens automatically during the
    // forward migration; here we seed it directly since the migration only
    // runs once against a fresh, empty test database).
    const originalId = randomUUID();
    await p.query(
      `INSERT INTO packing_lists_v2_trip_item_backup (backup_id, original_id, trip_id, category, label, position)
       VALUES ($1, $2, $3, 'General', 'Restored Item', 0)
       ON CONFLICT (original_id) DO NOTHING`,
      [randomUUID(), originalId, tripId]
    );

    const beforeRestore: any = await p.query(`SELECT id FROM trip_packing_list_items WHERE id = $1`, [originalId]);
    expect(beforeRestore.rows).toHaveLength(0);

    // Exercise the same restore statement the rollback file runs (the full
    // rollback also drops v2 tables that other tests in this suite still
    // need, so only the restore portion is replayed here).
    await p.query(
      `INSERT INTO trip_packing_list_items (id, trip_id, category, label, position, source_user_id, created_at, updated_at)
       SELECT backup.original_id, backup.trip_id, backup.category, backup.label, backup.position, backup.source_user_id, backup.backed_up_at, backup.backed_up_at
       FROM packing_lists_v2_trip_item_backup backup
       LEFT JOIN trip_packing_list_items item ON item.id = backup.original_id
       WHERE backup.original_id = $1 AND item.id IS NULL`,
      [originalId]
    );

    const afterRestore: any = await p.query(`SELECT label FROM trip_packing_list_items WHERE id = $1`, [originalId]);
    expect(afterRestore.rows).toHaveLength(1);
    expect(afterRestore.rows[0].label).toBe('Restored Item');
  });
});
