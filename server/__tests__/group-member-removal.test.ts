import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { closePool, getPool, initDb } from '../src/db';
import { registerAndLoginDeviceUser, registerDeviceUser } from './helpers';

describe('Group member removal cleans related items', () => {
  const owner = { email: 'remove-owner@example.com', firstName: 'Remove', lastName: 'Owner', password: 'testtest' };
  const member = { email: 'remove-member@example.com', firstName: 'Remove', lastName: 'Member', password: 'testtest' };
  let pool: Pool;
  let ownerToken: string;
  let groupId: string;
  let tripId: string;
  let ownerMemberId: string;
  let memberId: string;

  beforeAll(async () => {
    pool = getPool();
    await initDb();
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, member.email]);

    const ownerLogin = await registerAndLoginDeviceUser(pool, owner);
    ownerToken = ownerLogin.token;

    await registerDeviceUser(member);

    const groupRes = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Removal Group', members: [] })
      .expect(201);
    groupId = groupRes.body.id;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: member.email })
      .expect(201);

    const membersRes = await request(app)
      .get(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    ownerMemberId = membersRes.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;
    memberId = membersRes.body.find((m: any) => (m.email ?? m.userEmail) === member.email)?.id;
    if (!ownerMemberId || !memberId) {
      throw new Error(`Unable to resolve member ids: owner=${ownerMemberId} member=${memberId}`);
    }

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Removal Trip', groupId })
      .expect(201);
    tripId = tripRes.body.id;

    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        passengerIds: [memberId],
        departureDate: '2026-05-01',
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

    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        passengerIds: [memberId, ownerMemberId],
        departureDate: '2026-05-02',
        departureTime: '09:00',
        arrivalTime: '11:00',
        tripId,
        cost: 200,
        carrier: '',
        flightNumber: '',
        bookingReference: '',
        paidBy: [memberId, ownerMemberId],
      })
      .expect(201);

    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        tripId,
        name: 'Removal Lodging',
        checkInDate: '2026-05-01',
        checkOutDate: '2026-05-03',
        rooms: '1',
        refundBy: '2026-04-25',
        totalCost: '300',
        costPerNight: '150',
        address: '123 Test',
        paidBy: [memberId],
      })
      .expect(201);

    await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        tripId,
        date: '2026-05-02',
        name: 'Removal Tour',
        startLocation: 'Test',
        startTime: '10:00',
        duration: '2h',
        cost: '50',
        freeCancelBy: '2026-04-28',
        bookedOn: '2026-04-20',
        reference: 'REF1',
        paidBy: [memberId, ownerMemberId],
      })
      .expect(201);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, member.email]);
    await closePool();
  });

  it('removes member from flights and payers when removed from group', async () => {
    const removeRes = await request(app)
      .delete(`/api/groups/${groupId}/members/${memberId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    if (removeRes.status !== 204) {
      throw new Error(`Remove failed: ${removeRes.status} ${JSON.stringify(removeRes.body)}`);
    }

    const flightsRes = await request(app)
      .get(`/api/flights?tripId=${tripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const flights = flightsRes.body as any[];
    expect(flights.length).toBe(1);
    expect(flights[0].passengerIds || flights[0].passenger_ids).toEqual([ownerMemberId]);
    expect(flights[0].paidBy || flights[0].paid_by).toEqual([ownerMemberId]);

    const lodgingsRes = await request(app)
      .get(`/api/lodgings?tripId=${tripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(lodgingsRes.body).toHaveLength(0);

    const toursRes = await request(app)
      .get(`/api/activities?tripId=${tripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const tourPaidBy = toursRes.body[0].paidBy || toursRes.body[0].paid_by;
    expect(tourPaidBy).toEqual([ownerMemberId]);
  });
});

