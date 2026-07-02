/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, getUserPackingList, replaceUserPackingList, getTripPackingList, replaceUniversalPackingList } from '../src/db';
import { DEFAULT_PACKING_LIST_ITEMS } from '../src/config/defaultPackingList';
import { cleanupTestUsersByEmail, makeAdminUser, registerAndLoginWebUser, seedTiersForTest } from './helpers';

describe('packing lists', () => {
  const defaultItems = DEFAULT_PACKING_LIST_ITEMS;
  const owner = { email: 'packing-owner@example.com', firstName: 'Packing', lastName: 'Owner', password: 'testtest' };
  const traveler = { email: 'packing-traveler@example.com', firstName: 'Packing', lastName: 'Traveler', password: 'testtest' };
  const admin = { email: 'packing-admin@example.com', firstName: 'Packing', lastName: 'Admin', password: 'testtest' };
  let ownerToken: string;
  let ownerId: string;
  let travelerId: string;
  let travelerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    await cleanupTestUsersByEmail([owner.email, traveler.email, admin.email]);
    await replaceUniversalPackingList(defaultItems);
    const ownerLogin = await registerAndLoginWebUser(owner);
    ownerToken = ownerLogin.token;
    ownerId = ownerLogin.userId;
    const travelerLogin = await registerAndLoginWebUser(traveler);
    travelerToken = travelerLogin.token;
    travelerId = travelerLogin.userId;
    adminToken = (await makeAdminUser(admin)).token;
  });

  afterAll(async () => {
    if (adminToken) {
      await request(app)
        .put('/api/admin/packing-list-defaults')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'restore defaults after test', items: defaultItems })
        .catch(() => undefined);
    }
    await cleanupTestUsersByEmail([owner.email, traveler.email, admin.email]);
    await closePool();
  });

  it('creates a default packing list for existing and newly created users', async () => {
    const ownerList = await getUserPackingList(ownerId);
    const travelerList = await getUserPackingList(travelerId);
    expect(ownerList).toHaveLength(defaultItems.length);
    expect(travelerList).toHaveLength(defaultItems.length);
    expect(ownerList.map((item) => item.label)).toContain('undies');
    expect(ownerList.map((item) => item.label)).toContain('laundry net for delicates');
    expect(travelerList.map((item) => item.label)).toContain('cell phone charger');
  });

  it('adds a trip packing list and merges traveler defaults into the trip list', async () => {
    await replaceUserPackingList(travelerId, [
      { category: 'Personal', label: 'Prescription sunglasses' },
      { category: 'Documents', label: 'Passport or government ID' },
    ]);

    const created = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Packing Merge Trip',
        startDate: '2027-06-01',
        endDate: '2027-06-04',
        participants: [{ firstName: traveler.firstName, lastName: traveler.lastName, email: traveler.email }],
      })
      .expect(201);

    const tripId = created.body.trip.id as string;
    let tripList = await getTripPackingList(ownerId, tripId);
    expect(tripList.items.map((item) => item.label)).toContain('undies');
    expect(tripList.items.map((item) => item.label)).not.toContain('Prescription sunglasses');

    const pending = await request(app)
      .get('/api/groups/invites')
      .set('Authorization', `Bearer ${travelerToken}`)
      .expect(200);
    const invite = pending.body.find((entry: any) => entry.tripId === tripId);
    expect(invite).toBeTruthy();

    await request(app)
      .post(`/api/groups/invites/${invite.id}/accept`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .expect(204);

    tripList = await getTripPackingList(ownerId, tripId);
    expect(tripList.items.map((item) => item.label)).toContain('Prescription sunglasses');
    expect(tripList.travelers.map((entry) => entry.email)).toContain(traveler.email);
  });

  it('lets admins edit universal defaults without overwriting users who already have a list', async () => {
    await request(app)
      .put('/api/admin/packing-list-defaults')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reason: 'test default update',
        items: [
          { category: 'Documents', label: 'Passport or government ID' },
          { category: 'Electronics', label: 'Noise-canceling headphones' },
        ],
      })
      .expect(200);

    const ownerList = await getUserPackingList(ownerId);
    expect(ownerList.map((item) => item.label)).toContain('cell phone charger');
    const defaults = await request(app)
      .get('/api/admin/packing-list-defaults')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(defaults.body.items.map((item: any) => item.label)).toContain('Noise-canceling headphones');
  });

});
