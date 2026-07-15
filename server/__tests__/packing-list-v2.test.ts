import request from 'supertest';
import { app } from '../src/app';
import {
  closePool,
  initDb,
  createTripWithGroupAndMembers,
  getPackingListV2,
  getUserPackingListV2,
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

  it('composes profile presets and trip additions into ordered groups', async () => {
    await replaceUserPackingPreferencesV2(ownerId, ['general', 'hiking'], [{ category: 'Personal', label: 'Personal travel journal' }]);
    const created = await createTripWithGroupAndMembers({ ownerId, tripName: 'V2 trip', members: [] });
    const initial = await getPackingListV2(ownerId, created.trip.id);
    expect(initial.groups[0].label).toBe('General');
    expect(initial.groups.some((group) => group.label.toLowerCase().includes('hiking'))).toBe(true);
    expect(initial.groups.some((group) => group.label.includes('Owner'))).toBe(true);

    const added = await request(app)
      .post(`/api/trips/${created.trip.id}/packing-list/presets`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ presetKey: 'beach' })
      .expect(200);
    expect(added.body.groups.some((group: any) => group.label.toLowerCase().includes('beach'))).toBe(true);
    const manual = await request(app)
      .put(`/api/trips/${created.trip.id}/packing-list`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ items: [{ category: 'Trip notes', label: 'Trip-only item' }] })
      .expect(200);
    expect(manual.body.groups.some((group: any) => group.label === 'Trip additions')).toBe(true);
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
});
