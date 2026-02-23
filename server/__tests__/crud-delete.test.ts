import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';
import { registerAndLoginWebUser } from './helpers';

describe('CRUD delete endpoints for flights, lodgings, tours, and trips', () => {
  jest.setTimeout(60000);
  const uniq = Date.now();
  const user = { email: `delete+${uniq}@example.com`, firstName: 'Delete', lastName: 'Tester', password: 'testtest' };
  const member = { email: `delete-member+${uniq}@example.com`, firstName: 'Delete', lastName: 'Member', password: 'testtest' };
  let token: string;
  let memberToken: string;
  let groupId: string;
  let memberId: string;
  let tripId: string;
  let pool: Pool;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const login = await registerAndLoginWebUser(pool, user);
    token = login.token;
    const memberLogin = await registerAndLoginWebUser(pool, member);
    memberToken = memberLogin.token;

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: member.email })
      .expect(201);

    const invites = await request(app).get('/api/groups/invites').set('Authorization', `Bearer ${memberToken}`).expect(200);
    const inviteId = invites.body[0]?.id as string;
    expect(inviteId).toBeTruthy();
    await request(app).post(`/api/groups/invites/${inviteId}/accept`).set('Authorization', `Bearer ${memberToken}`).expect(204);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token}`).expect(200);
    memberId = members.body.find((m: any) => (m.email ?? m.userEmail) === user.email)?.id as string;
    expect(memberId).toBeTruthy();

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Delete Trip ${uniq}`, groupId })
      .expect(201);
    tripId = tripRes.body.id as string;
    expect(tripId).toBeTruthy();
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user.email, member.email]);
      await pool.end();
    }
    await closePool();
  });

  it('creates and deletes a flight, lodging, and tour', async () => {
    const flightRes = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [memberId],
        departureDate: '2026-05-10',
        departureTime: '08:00',
        arrivalTime: '10:00',
        tripId,
        cost: 100,
        carrier: '',
        flightNumber: '',
        bookingReference: '',
        paidBy: [memberId],
      })
      .expect(201);
    const flightId = flightRes.body.id as string;
    expect(flightId).toBeTruthy();

    const lodgingRes = await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        name: 'Delete Hotel',
        checkInDate: '2026-05-10',
        checkOutDate: '2026-05-12',
        rooms: '1',
        totalCost: '200',
        costPerNight: '100',
        paidBy: [memberId],
      })
      .expect(201);
    const lodgingId = lodgingRes.body.id as string;
    expect(lodgingId).toBeTruthy();

    const tourRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        date: '2026-05-11',
        name: 'Delete Tour',
        startLocation: 'Test',
        startTime: '09:00',
        duration: '2h',
        cost: '50',
        paidBy: [memberId],
      })
      .expect(201);
    const tourId = tourRes.body.id as string;
    expect(tourId).toBeTruthy();

    await request(app).delete(`/api/transfers/${flightId}`).set('Authorization', `Bearer ${token}`).expect(204);
    await request(app).delete(`/api/lodgings/${lodgingId}`).set('Authorization', `Bearer ${token}`).expect(204);
    await request(app).delete(`/api/activities/${tourId}`).set('Authorization', `Bearer ${token}`).expect(204);

    const flights = await request(app).get(`/api/transfers?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(flights.body).toHaveLength(0);
    const lodgings = await request(app).get(`/api/lodgings?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(lodgings.body).toHaveLength(0);
    const tours = await request(app).get(`/api/activities?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(tours.body).toHaveLength(0);
  });

  it('deletes a trip and removes it from the list', async () => {
    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Delete Trip 2 ${uniq}`, groupId })
      .expect(201);
    const deleteTripId = tripRes.body.id as string;

    await request(app).delete(`/api/trips/${deleteTripId}`).set('Authorization', `Bearer ${token}`).expect(204);

    const trips = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`).expect(200);
    const exists = (trips.body as any[]).some((t) => t.id === deleteTripId);
    expect(exists).toBe(false);
  });

  it('removes only the deleting user unless they are the last traveler', async () => {
    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Shared Delete Trip ${uniq}`, groupId })
      .expect(201);
    const sharedTripId = tripRes.body.id as string;
    expect(sharedTripId).toBeTruthy();

    await request(app).delete(`/api/trips/${sharedTripId}`).set('Authorization', `Bearer ${token}`).expect(204);

    const ownerTrips = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`).expect(200);
    expect((ownerTrips.body as any[]).some((t) => t.id === sharedTripId)).toBe(false);

    const memberTrips = await request(app).get('/api/trips').set('Authorization', `Bearer ${memberToken}`).expect(200);
    expect((memberTrips.body as any[]).some((t) => t.id === sharedTripId)).toBe(true);

    await request(app).delete(`/api/trips/${sharedTripId}`).set('Authorization', `Bearer ${memberToken}`).expect(204);

    const memberTripsAfter = await request(app).get('/api/trips').set('Authorization', `Bearer ${memberToken}`).expect(200);
    expect((memberTripsAfter.body as any[]).some((t) => t.id === sharedTripId)).toBe(false);
  });
});

