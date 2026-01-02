import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';

describe('Flights API passenger validation', () => {
  const user = { email: 'flight-user@example.com', firstName: 'Flight', lastName: 'Owner', password: 'testtest' };
  const member = { email: 'flight-member@example.com', firstName: 'Second', lastName: 'User', password: 'testtest' };
  let pool: Pool;
  let token: string;
  let tripId: string;
  let memberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user.email, member.email]);
    const reg = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: user.firstName, lastName: user.lastName, email: user.email, password: user.password, passwordConfirm: user.password })
      .expect(201);
    token = reg.body.token as string;

    // Create the passenger as a real user so they can be added to the group.
    await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: member.firstName, lastName: member.lastName, email: member.email, password: member.password, passwordConfirm: member.password })
      .expect(201);

    // Create a trip and add a second member
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    const groupId = groups.body[0]?.id as string;
    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Flight Trip', groupId })
      .expect(201);
    tripId = trip.body.id as string;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: member.email })
      .expect(201);

    const groupsAfter = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    const group = groupsAfter.body.find((g: any) => g.id === groupId);
    memberId = group.members.find((m: any) => m.userEmail === member.email)?.id as string;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user.email, member.email]);
      await pool.end();
    }
    await closePool();
  });

  it('rejects creating a flight without passengers', async () => {
    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [],
        departureDate: '2025-01-01',
        departureTime: '10:00',
        arrivalTime: '12:00',
        carrier: 'AA',
        flightNumber: '100',
        bookingReference: 'ABC123',
        tripId,
        cost: 100,
      })
      .expect(400);
  });

  it('rejects passengers not in group', async () => {
    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: ['00000000-0000-0000-0000-000000000000'],
        departureDate: '2025-01-01',
        departureTime: '10:00',
        arrivalTime: '12:00',
        carrier: 'AA',
        flightNumber: '100',
        bookingReference: 'ABC123',
        tripId,
        cost: 100,
      })
      .expect(400);
  });

  it('creates and updates a flight with group passengers', async () => {
    const createRes = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [memberId],
        departureDate: '2025-01-02',
        departureTime: '09:00',
        arrivalTime: '11:00',
        carrier: 'DL',
        flightNumber: '200',
        bookingReference: 'DEF456',
        tripId,
        cost: 200,
      })
      .expect(201);

    const flightId = createRes.body.id as string;
    expect(createRes.body.passenger_ids || createRes.body.passengerIds).toBeTruthy();

    // Update with empty passengers should fail
    await request(app)
      .patch(`/api/flights/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passengerIds: [] })
      .expect(400);

    // Update with same passenger succeeds
    await request(app)
      .patch(`/api/flights/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passengerIds: [memberId], carrier: 'DL2' })
      .expect(200);
  });
});
