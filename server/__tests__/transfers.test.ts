import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser, registerWebUser, seedTiersForTest, setUserTierInDb, cleanupTestUsersByEmail } from './helpers';

describe('Flights API passenger validation', () => {
  const uniq = Date.now();
  const user = { email: `flight-user+${uniq}@example.com`, firstName: 'Flight', lastName: 'Owner', password: 'testtest' };
  const member = { email: `flight-member+${uniq}@example.com`, firstName: 'Second', lastName: 'User', password: 'testtest' };
  let token: string;
  let tripId: string;
  let memberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    await cleanupTestUsersByEmail([user.email, member.email]);
    const login = await registerAndLoginWebUser(user);
    token = login.token;
    await setUserTierInDb(login.userId, 'premium');

    // Create the passenger as a real user so they can be added to the group.
    await registerWebUser(member);

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
    await cleanupTestUsersByEmail([user.email, member.email]);
    await closePool();
  });

  it('rejects creating a flight without passengers', async () => {
    await request(app)
      .post('/api/transfers')
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
      .post('/api/transfers')
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
      .post('/api/transfers')
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
      .patch(`/api/transfers/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passengerIds: [] })
      .expect(200);
    expect(emptyUpdate.body.passengerIds || emptyUpdate.body.passenger_ids).toContain(memberId);

    // Update with same passenger succeeds
    await request(app)
      .patch(`/api/transfers/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ passengerIds: [memberId], carrier: 'DL2' })
      .expect(200);
  });

  it('creates a flight with optional carrier, flight number, and booking reference', async () => {
    const createRes = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [memberId],
        departureDate: '2025-01-03',
        departureTime: '08:30',
        arrivalTime: '10:30',
        carrier: '',
        flightNumber: '',
        bookingReference: '',
        tripId,
        cost: 150,
      })
      .expect(201);

    expect(createRes.body.carrier ?? '').toBe('');
    expect(createRes.body.flightNumber ?? createRes.body.flight_number ?? '').toBe('');
    expect(createRes.body.bookingReference ?? createRes.body.booking_reference ?? '').toBe('');
  });

  it('creates a transfer with a non-flight transfer type', async () => {
    const createRes = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [memberId],
        departureDate: '2025-01-04',
        departureTime: '08:30',
        arrivalTime: '10:30',
        carrier: '',
        flightNumber: '',
        bookingReference: '',
        transferType: 'Train',
        tripId,
        cost: 150,
      })
      .expect(201);

    expect(createRes.body.transferType ?? createRes.body.transfer_type ?? 'Flight').toBe('Train');
  });

  it('defaults arrival date to departure date and allows updating it', async () => {
    const depDate = '2025-01-05';
    const createRes = await request(app)
      .post('/api/transfers')
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
      .patch(`/api/transfers/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ arrivalDate: newArrivalDate })
      .expect(200);
    expect(String(updateRes.body.arrivalDate ?? updateRes.body.arrival_date)).toContain(newArrivalDate);
  });

  it('updates flight expenses when paidBy is patched', async () => {
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    const groupId = groups.body[0]?.id as string;
    const membersRes = await request(app)
      .get(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const payerMemberId = membersRes.body[0]?.id as string;
    expect(payerMemberId).toBeTruthy();
    const createRes = await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [payerMemberId],
        departureDate: '2025-01-08',
        departureLocation: 'AAA',
        departureTime: '07:00',
        arrivalLocation: 'BBB',
        arrivalTime: '09:00',
        carrier: 'AA',
        flightNumber: '400',
        bookingReference: 'EXP400',
        tripId,
        cost: 250,
      })
      .expect(201);

    const flightId = createRes.body.id as string;

    const patchRes = await request(app)
      .patch(`/api/transfers/${flightId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paidBy: [payerMemberId] });
    if (patchRes.status !== 200) {
      throw new Error(`PATCH failed: ${patchRes.status} ${JSON.stringify(patchRes.body)}`);
    }
    const patchedPaidBy = patchRes.body.paidBy || patchRes.body.paid_by || [];
    expect(patchedPaidBy).toEqual([payerMemberId]);

    const expensesRes = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const flightExpense = (expensesRes.body as any[]).find(
      (e: any) => e.sourceType === 'flight' && e.sourceId === flightId
    );
    expect(flightExpense).toBeTruthy();
    expect(flightExpense.payerIds).toEqual([payerMemberId]);
  });

  it('creates a flight without using a SQL pool when firebase provider is active', async () => {
    const db = require('../src/db');
    const providerSpy = jest.spyOn(db, 'getCurrentDbProvider').mockReturnValue('firebase');
    const ensureSpy = jest.spyOn(db, 'ensureUserInTrip').mockResolvedValue({ groupId: tripId });
    const membersSpy = jest.spyOn(db, 'listGroupMembers').mockResolvedValue([
      { id: 'm-owner', status: 'active', firstName: user.firstName, lastName: user.lastName, email: user.email },
      { id: 'm-member', status: 'active', firstName: member.firstName, lastName: member.lastName, email: member.email },
    ]);
    const insertSpy = jest.spyOn(db, 'insertFlight').mockImplementation(async (payload: any) => ({ ...payload, id: 'fake-flight' }));

    await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: ['m-member'],
        departureDate: '2025-03-01',
        departureTime: '10:00',
        arrivalTime: '12:00',
        carrier: 'AA',
        flightNumber: '200',
        bookingReference: 'BOOK200',
        tripId,
        cost: 200,
        paidBy: ['m-owner'],
      })
      .expect(201);

    providerSpy.mockRestore();
    ensureSpy.mockRestore();
    membersSpy.mockRestore();
    insertSpy.mockRestore();
  });
});

describe('Pending passengers and payer rules', () => {
  const uniq = Date.now();
  const owner = { email: `flight-owner+${uniq}@example.com`, firstName: 'Owner', lastName: 'Pending', password: 'testtest' };
  const pendingEmail = `pending-passenger+${uniq}@example.com`;
  let token: string;
  let tripId: string;
  let groupId: string;
  let pendingId: string;
  let ownerMemberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    await cleanupTestUsersByEmail([owner.email]);

    const login = await registerAndLoginWebUser(owner);
    token = login.token;
    await setUserTierInDb(login.userId, 'premium');

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
    await cleanupTestUsersByEmail([owner.email]);
    await closePool();
  });

  it('allows creating a flight with a pending passenger', async () => {
    const res = await request(app)
      .post('/api/transfers')
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

  it('allows pending passengers as payers', async () => {
    await request(app)
      .post('/api/transfers')
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
      .expect(201);

    // Owner can still be a payer
    await request(app)
      .post('/api/transfers')
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
    await seedTiersForTest();
    await cleanupTestUsersByEmail([owner.email, member.email]);

    const ownerLogin = await registerAndLoginWebUser(owner);
    ownerToken = ownerLogin.token;
    await setUserTierInDb(ownerLogin.userId, 'premium');

    const memberLogin = await registerAndLoginWebUser(member);
    memberToken = memberLogin.token;
    await setUserTierInDb(memberLogin.userId, 'premium');

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

    const invites = await request(app).get('/api/groups/invites').set('Authorization', `Bearer ${memberToken}`).expect(200);
    const inviteId = invites.body[0]?.id as string;
    expect(inviteId).toBeTruthy();
    await request(app).post(`/api/groups/invites/${inviteId}/accept`).set('Authorization', `Bearer ${memberToken}`).expect(204);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    ownerMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;
    memberMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === member.email)?.id;
    expect(ownerMemberId).toBeTruthy();
    expect(memberMemberId).toBeTruthy();

    const flight = await request(app)
      .post('/api/transfers')
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
    await cleanupTestUsersByEmail([owner.email, member.email]);
    await closePool();
  });

  it('removes member from trip data without removing them from the group', async () => {
    await request(app).delete(`/api/trips/${tripId}`).set('Authorization', `Bearer ${memberToken}`).expect(204);

    const flights = await request(app).get(`/api/transfers?tripId=${tripId}`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const flight = flights.body.find((f: any) => f.id === flightId);
    expect(flight).toBeTruthy();
    expect(flight.passengerIds || flight.passenger_ids || []).not.toContain(memberMemberId);
    expect(flight.paidBy || flight.paid_by || []).not.toContain(memberMemberId);

    const membersAfter = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const activeMember = membersAfter.body.find((m: any) => (m.email ?? m.userEmail) === member.email);
    expect(activeMember).toBeTruthy();
    expect(activeMember.status).toBe('active');
  });
});
