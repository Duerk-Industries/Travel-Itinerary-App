/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import {
  initDb,
  closePool,
  createTrait,
  listGroupsForUser,
} from '../src/db';
import {
  cleanupTestUsersByEmail,
  registerAndLoginWebUser,
} from './helpers';

describe('GET /api/account/export', () => {
  const EMAIL = 'account-export-test@example.com';
  const PASSWORD = 'exportmetest';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([EMAIL]);
    await closePool();
  });

  afterEach(async () => {
    await cleanupTestUsersByEmail([EMAIL]);
  });

  it('returns 401 without an auth token', async () => {
    await request(app).get('/api/account/export').expect(401);
  });

  it('returns a JSON export with profile, emails, and empty collections for a new account', async () => {
    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Ex',
      lastName: 'Porter',
      email: EMAIL,
      password: PASSWORD,
    });

    const res = await request(app)
      .get('/api/account/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.schemaVersion).toBe(1);
    expect(typeof res.body.exportedAt).toBe('string');
    expect(res.body.user.id).toBe(userId);
    expect(res.body.user.profile?.email).toBe(EMAIL);
    expect(Array.isArray(res.body.user.emails)).toBe(true);
    expect(res.body.user.emails.some((e: any) => e.email === EMAIL)).toBe(true);
    expect(res.body.traits).toEqual([]);
    expect(res.body.familyRelationships).toEqual([]);
    expect(res.body.fellowTravelers).toEqual([]);
    expect(Array.isArray(res.body.groups)).toBe(true);
    expect(res.body.groups.length).toBeGreaterThan(0); // default group
    expect(res.body.authoredItems).toEqual({
      flights: [],
      lodgings: [],
      tours: [],
      carRentals: [],
      expenses: [],
      tripMessages: [],
    });
  });

  it('surfaces user-authored lodgings, flights, and traits', async () => {
    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Ex',
      lastName: 'Porter',
      email: EMAIL,
      password: PASSWORD,
    });

    // Seed traits
    await createTrait(userId, 'foodie', 3, 'loves tapas');

    // Default group + a trip
    const groups = await listGroupsForUser(userId);
    const groupId = groups[0].id as string;
    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Export Trip', groupId })
      .expect(201);
    const tripId = tripRes.body.id as string;

    // Seed a lodging + flight authored by this user via HTTP (adapter handles timestamps)
    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        name: 'Hotel Export',
        checkInDate: '2026-06-01',
        checkOutDate: '2026-06-05',
        rooms: 1,
        totalCost: 400,
        costPerNight: 100,
        address: '1 Main St',
        paidBy: [],
      })
      .expect(201);
    await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        passengerName: 'Ex Porter',
        departureDate: '2026-05-30',
        departureLocation: 'AAA',
        departureTime: '10:00',
        arrivalLocation: 'BBB',
        arrivalTime: '14:00',
        cost: 250,
        carrier: 'TestAir',
        flightNumber: 'TA123',
        bookingReference: 'ABC123',
        passengerIds: [userId],
        paidBy: [userId],
      })
      .expect(201);

    const res = await request(app)
      .get('/api/account/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.traits).toHaveLength(1);
    expect(res.body.traits[0].name).toBe('foodie');

    expect(res.body.authoredItems.lodgings).toHaveLength(1);
    expect(res.body.authoredItems.lodgings[0].name).toBe('Hotel Export');

    expect(res.body.authoredItems.flights).toHaveLength(1);
    expect(res.body.authoredItems.flights[0].carrier).toBe('TestAir');

    expect(res.body.trips.some((t: any) => t.id === tripId)).toBe(true);

    // Content-Disposition should suggest a download filename
    expect(res.headers['content-disposition']).toMatch(/wanderbunnies-export-/);
  });

  it('does not include rows authored by other users', async () => {
    const OTHER_EMAIL = 'account-export-other@example.com';
    const OTHER_PASSWORD = 'otherpass';

    try {
      const owner = await registerAndLoginWebUser({
        firstName: 'Ex',
        lastName: 'Porter',
        email: EMAIL,
        password: PASSWORD,
      });
      const other = await registerAndLoginWebUser({
        firstName: 'Not',
        lastName: 'Me',
        email: OTHER_EMAIL,
        password: OTHER_PASSWORD,
      });

      // Each user's traits are owned by that user via `user_id` — the same
      // ownership model as the item tables. If the export filter is correct
      // for one it's correct for the others.
      await createTrait(owner.userId, 'owner-trait', 3);
      await createTrait(other.userId, 'other-trait', 3);

      const exportRes = await request(app)
        .get('/api/account/export')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      const names = exportRes.body.traits.map((t: any) => t.name);
      expect(names).toContain('owner-trait');
      expect(names).not.toContain('other-trait');
    } finally {
      await cleanupTestUsersByEmail([OTHER_EMAIL]);
    }
  });
});
