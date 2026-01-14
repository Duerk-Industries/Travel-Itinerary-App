import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { buildFlightDraftFromRow } from '../../app/utils/overviewEditing';
const buildPayload = (draft: any, defaultPayerId?: string | null) => {
  const trim = (v?: string | null) => (v ?? '').trim();
  const passengerIds = Array.isArray(draft.passengerIds) ? draft.passengerIds.filter(Boolean) : [];
  return {
    passengerName: trim(draft.passengerName) || 'Traveler',
    passengerIds,
    departureDate: trim(draft.departureDate),
    arrivalDate: trim(draft.arrivalDate) || trim(draft.departureDate),
    departureLocation: '',
    departureAirportCode: trim(draft.departureAirportCode),
    departureTime: trim(draft.departureTime),
    arrivalLocation: '',
    arrivalAirportCode: trim(draft.arrivalAirportCode),
    layoverLocation: trim(draft.layoverLocation),
    layoverLocationCode: trim(draft.layoverLocationCode),
    layoverDuration: trim(draft.layoverDuration),
    arrivalTime: trim(draft.arrivalTime),
    cost: Number(draft.cost) || 0,
    carrier: trim(draft.carrier) || 'UNKNOWN',
    flightNumber: trim(draft.flightNumber) || 'UNKNOWN',
    bookingReference: trim(draft.bookingReference) || 'UNKNOWN',
    paidBy: draft.paidBy?.length ? draft.paidBy : defaultPayerId ? [defaultPayerId] : [],
  };
};

describe('Overview flight edit retains passengers', () => {
  const owner = { email: 'overview-owner@example.com', firstName: 'Owner', lastName: 'Overview', password: 'testtest' };
  const member = { email: 'overview-member@example.com', firstName: 'Member', lastName: 'Overview', password: 'testtest' };
  const pendingEmail = 'overview-pending@example.com';
  let pool: Pool;
  let ownerToken: string;
  let groupId: string;
  let tripId: string;
  let ownerMemberId: string;
  let memberMemberId: string;
  let pendingMemberId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [owner.email, member.email, pendingEmail]);

    const regOwner = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: owner.firstName, lastName: owner.lastName, email: owner.email, password: owner.password, passwordConfirm: owner.password })
      .expect(201);
    ownerToken = regOwner.body.token as string;

    const regMember = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: member.firstName, lastName: member.lastName, email: member.email, password: member.password, passwordConfirm: member.password })
      .expect(201);
    expect(regMember.body.token).toBeTruthy();

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    groupId = groups.body[0]?.id as string;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: member.email })
      .expect(201);

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: pendingEmail })
      .expect(201);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${ownerToken}`).expect(200);
    ownerMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;
    memberMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === member.email)?.id;
    pendingMemberId = members.body.find((m: any) => (m.email ?? m.userEmail) === pendingEmail)?.id;

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Overview Trip', groupId })
      .expect(201);
    tripId = trip.body.id as string;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [owner.email, member.email, pendingEmail]);
      await pool.end();
    }
    await closePool();
  });

  const patchViaOverviewDraft = (flight: any, newDate: string) => {
    const draft = buildFlightDraftFromRow(flight as any);
    const payload = buildPayload(
      {
        ...draft,
        passengerIds: draft.passengerIds,
        passengerName: draft.passengerName,
        departureDate: newDate,
      },
      ownerMemberId
    );
    return request(app).patch(`/api/flights/${flight.id}`).set('Authorization', `Bearer ${ownerToken}`).send(payload);
  };

  it('saves edits for flights with pending passengers and full members', async () => {
    // Pending passenger flight
    const pendingFlight = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        passengerIds: [pendingMemberId],
        departureDate: '2026-02-01',
        departureTime: '09:00',
        arrivalTime: '11:00',
        carrier: 'OV',
        flightNumber: 'PEN1',
        bookingReference: 'OV-PEN',
        tripId,
        cost: 100,
        paidBy: [ownerMemberId],
      })
      .expect(201);

    await patchViaOverviewDraft(pendingFlight.body, '2026-02-02').expect(200);

    // Member passenger flight
    const memberFlight = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        passengerIds: [memberMemberId],
        departureDate: '2026-03-01',
        departureTime: '10:00',
        arrivalTime: '12:00',
        carrier: 'OV',
        flightNumber: 'MEM1',
        bookingReference: 'OV-MEM',
        tripId,
        cost: 150,
        paidBy: [ownerMemberId],
      })
      .expect(201);

    await patchViaOverviewDraft(memberFlight.body, '2026-03-02').expect(200);
  });
});
