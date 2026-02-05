import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';

describe('Expense sync for source-backed items', () => {
  const uniq = Date.now();
  const userA = { email: `expense-sync-a+${uniq}@example.com`, firstName: 'Expense', lastName: 'SyncA', password: 'testtest' };
  const userB = { email: `expense-sync-b+${uniq}@example.com`, firstName: 'Expense', lastName: 'SyncB', password: 'testtest' };
  let pool: Pool;
  let tokenA: string;
  let groupId: string;
  let tripId: string;
  let memberA: string;
  let memberB: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const regA = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: userA.firstName, lastName: userA.lastName, email: userA.email, password: userA.password, passwordConfirm: userA.password })
      .expect(201);
    tokenA = regA.body.token as string;

    const groupsA = await request(app).get('/api/groups').set('Authorization', `Bearer ${tokenA}`).expect(200);
    groupId = groupsA.body[0]?.id as string;

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `Expense Sync Trip ${uniq}`, groupId })
      .expect(201);
    tripId = trip.body.id as string;

    await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: userB.firstName, lastName: userB.lastName, email: userB.email, password: userB.password, passwordConfirm: userB.password })
      .expect(201);

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: userB.email })
      .expect(201);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    memberA = members.body.find((m: any) => (m.email ?? m.userEmail) === userA.email)?.id;
    memberB = members.body.find((m: any) => (m.email ?? m.userEmail) === userB.email)?.id;
  });

  afterAll(async () => {
    await pool.end();
    await closePool();
  });

  it('updates a single flight expense row when paidBy changes', async () => {
    const flightRes = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        passengerIds: [memberA],
        departureDate: '2025-11-15',
        departureTime: '07:15',
        arrivalTime: '21:05',
        cost: 2084,
        paidBy: [memberA],
        carrier: 'Test Air',
        flightNumber: 'TA123',
      })
      .expect(201);

    const flightId = flightRes.body.id as string;

    let expenses = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    let flightExpenses = expenses.body.filter((e: any) => e.sourceType === 'flight' && e.sourceId === flightId);
    expect(flightExpenses).toHaveLength(1);
    expect(flightExpenses[0].payerIds).toEqual([memberA]);
    expect(flightExpenses[0].forIds).toEqual([memberA]);

    await request(app)
      .patch(`/api/flights/${flightId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ paidBy: [memberA, memberB] })
      .expect(200);

    expenses = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    flightExpenses = expenses.body.filter((e: any) => e.sourceType === 'flight' && e.sourceId === flightId);
    expect(flightExpenses).toHaveLength(1);
    expect(new Set(flightExpenses[0].payerIds)).toEqual(new Set([memberA, memberB]));
  });

  it('updates lodging expense travelers when travelerIds change', async () => {
    const lodgingRes = await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        name: 'Expense Sync Lodging',
        checkInDate: '2025-11-10',
        checkOutDate: '2025-11-12',
        rooms: 1,
        totalCost: 300,
        costPerNight: 150,
        paidBy: [memberA],
        travelerIds: [memberA],
      })
      .expect(201);

    const lodgingId = lodgingRes.body.id as string;

    let expenses = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    let lodgingExpenses = expenses.body.filter((e: any) => e.sourceType === 'lodging' && e.sourceId === lodgingId);
    expect(lodgingExpenses).toHaveLength(1);
    expect(lodgingExpenses[0].payerIds).toEqual([memberA]);
    expect(lodgingExpenses[0].forIds).toEqual([memberA]);

    await request(app)
      .patch(`/api/lodgings/${lodgingId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ travelerIds: [memberA, memberB] })
      .expect(200);

    expenses = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    lodgingExpenses = expenses.body.filter((e: any) => e.sourceType === 'lodging' && e.sourceId === lodgingId);
    expect(lodgingExpenses).toHaveLength(1);
    expect(new Set(lodgingExpenses[0].forIds)).toEqual(new Set([memberA, memberB]));
  });

  it('updates tour expense travelers when travelerIds change', async () => {
    const tourRes = await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        date: '2025-11-20',
        name: 'Expense Sync Tour',
        startLocation: 'City Center',
        startTime: '10:00',
        duration: '2h',
        cost: 120,
        paidBy: [memberA],
        travelerIds: [memberA],
      })
      .expect(201);

    const tourId = tourRes.body.id as string;

    let expenses = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    let tourExpenses = expenses.body.filter((e: any) => e.sourceType === 'tour' && e.sourceId === tourId);
    expect(tourExpenses).toHaveLength(1);
    expect(tourExpenses[0].payerIds).toEqual([memberA]);
    expect(tourExpenses[0].forIds).toEqual([memberA]);

    await request(app)
      .patch(`/api/tours/${tourId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ travelerIds: [memberA, memberB] })
      .expect(200);

    expenses = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    tourExpenses = expenses.body.filter((e: any) => e.sourceType === 'tour' && e.sourceId === tourId);
    expect(tourExpenses).toHaveLength(1);
    expect(new Set(tourExpenses[0].forIds)).toEqual(new Set([memberA, memberB]));
  });
});
