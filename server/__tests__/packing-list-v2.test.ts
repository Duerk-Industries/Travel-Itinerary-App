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
});
