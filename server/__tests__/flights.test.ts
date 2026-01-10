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

    // Update with empty passengers keeps existing passengers and succeeds
    const emptyUpdate = await request(app)
      .patch(`/api/flights/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passengerIds: [] })
      .expect(200);
    expect(emptyUpdate.body.passengerIds || emptyUpdate.body.passenger_ids).toContain(memberId);

    // Update with same passenger succeeds
    await request(app)
      .patch(`/api/flights/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passengerIds: [memberId], carrier: 'DL2' })
      .expect(200);
  });

  it('defaults arrival date to departure date and allows updating it', async () => {
    const depDate = '2025-01-05';
    const createRes = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [memberId],
        departureDate: depDate,
        departureTime: '07:00',
        arrivalTime: '09:00',
        carrier: 'AA',
        flightNumber: '300',
        bookingReference: 'ARR300',
        tripId,
        cost: 100,
      })
      .expect(201);

    const created = createRes.body;
    expect(String(created.arrivalDate ?? created.arrival_date)).toContain(depDate);
    const flightId = created.id as string;

    const newArrivalDate = '2025-01-06';
    const updateRes = await request(app)
      .patch(`/api/flights/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ arrivalDate: newArrivalDate })
      .expect(200);
    expect(String(updateRes.body.arrivalDate ?? updateRes.body.arrival_date)).toContain(newArrivalDate);
  });
});

describe('Pending passengers and payer rules', () => {
  const uniq = Date.now();
  const owner = { email: `flight-owner+${uniq}@example.com`, firstName: 'Owner', lastName: 'Pending', password: 'testtest' };
  const pendingEmail = `pending-passenger+${uniq}@example.com`;
  let pool: Pool;
  let token: string;
  let tripId: string;
  let groupId: string;
  let pendingId: string;
  let ownerMemberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email = $1', [owner.email]);

    const reg = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: owner.firstName, lastName: owner.lastName, email: owner.email, password: owner.password, passwordConfirm: owner.password })
      .expect(201);
    token = reg.body.token as string;

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pending Flight Trip', groupId })
      .expect(201);
    tripId = trip.body.id as string;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: pendingEmail })
      .expect(201);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token}`).expect(200);
    ownerMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;
    pendingId = members.body.find((m: any) => (m.email ?? m.userEmail) === pendingEmail)?.id;
    expect(ownerMemberId).toBeTruthy();
    expect(pendingId).toBeTruthy();
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email = $1', [owner.email]);
      await pool.end();
    }
    await closePool();
  });

  it('allows creating a flight with a pending passenger', async () => {
    const res = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [pendingId],
        departureDate: '2025-05-01',
        departureTime: '08:00',
        arrivalTime: '10:00',
        carrier: 'AA',
        flightNumber: '500',
        bookingReference: 'PEND1',
        tripId,
        cost: 50,
      })
      .expect(201);

    expect(res.body.passengerIds || res.body.passenger_ids).toContain(pendingId);
    expect(String(res.body.passengerName ?? res.body.passenger_name ?? '')).toBeTruthy();
  });

  it('rejects pending passengers as payers', async () => {
    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [pendingId],
        departureDate: '2025-05-02',
        departureTime: '12:00',
        arrivalTime: '14:00',
        carrier: 'AA',
        flightNumber: '501',
        bookingReference: 'PEND2',
        tripId,
        cost: 75,
        paidBy: [pendingId],
      })
      .expect(400);

    // Owner can still be a payer
    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [pendingId],
        departureDate: '2025-05-03',
        departureTime: '15:00',
        arrivalTime: '17:00',
        carrier: 'AA',
        flightNumber: '502',
        bookingReference: 'PEND3',
        tripId,
        cost: 80,
        paidBy: [ownerMemberId],
      })
      .expect(201);
  });
});

describe('Trip removal keeps passengers but strips payer status', () => {
  const uniq = Date.now() + 1;
  const owner = { email: `trip-owner+${uniq}@example.com`, firstName: 'Owner', lastName: 'Trip', password: 'testtest' };
  const member = { email: `trip-member+${uniq}@example.com`, firstName: 'Member', lastName: 'Trip', password: 'testtest' };
  let pool: Pool;
  let ownerToken: string;
  let memberToken: string;
  let groupId: string;
  let tripId: string;
  let ownerMemberId: string;
  let memberMemberId: string;
  let flightId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, member.email]);

    const regOwner = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: owner.firstName, lastName: owner.lastName, email: owner.email, password: owner.password, passwordConfirm: owner.password })
      .expect(201);
    ownerToken = regOwner.body.token as string;

    const regMember = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: member.firstName, lastName: member.lastName, email: member.email, password: member.password, passwordConfirm: member.password })
      .expect(201);
    memberToken = regMember.body.token as string;

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    groupId = groups.body[0]?.id as string;
    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Trip Removal Test', groupId })
      .expect(201);
    tripId = trip.body.id as string;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: member.email })
      .expect(201);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    ownerMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;
    memberMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === member.email)?.id;
    expect(ownerMemberId).toBeTruthy();
    expect(memberMemberId).toBeTruthy();

    const flight = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        passengerIds: [ownerMemberId, memberMemberId],
        departureDate: '2025-06-01',
        departureTime: '09:00',
        arrivalTime: '11:00',
        carrier: 'DL',
        flightNumber: '700',
        bookingReference: 'TRIP1',
        tripId,
        cost: 300,
        paidBy: [ownerMemberId, memberMemberId],
      })
      .expect(201);
    flightId = flight.body.id as string;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, member.email]);
      await pool.end();
    }
    await closePool();
  });

  it('removes payer status and keeps passenger when member drops the trip', async () => {
    await request(app).delete(`/api/trips/${tripId}`).set('Authorization', `Bearer ${memberToken}`).expect(204);

    const flights = await request(app).get(`/api/flights?tripId=${tripId}`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const flight = flights.body.find((f: any) => f.id === flightId);
    expect(flight).toBeTruthy();
    expect(flight.passengerIds || flight.passenger_ids).toContain(memberMemberId);
    expect(flight.paidBy || flight.paid_by || []).not.toContain(memberMemberId);

    const membersAfter = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const pendingMember = membersAfter.body.find((m: any) => (m.email ?? m.userEmail) === member.email);
    expect(pendingMember).toBeTruthy();
    expect(pendingMember.status).toBe('pending');
  });
});
