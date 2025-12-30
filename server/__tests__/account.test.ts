import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';

describe('Account lifecycle API with shared trip', () => {
  const user1 = { email: 'testuser@gmail.com', firstName: 'Test', lastName: 'User', password: 'testtest' };
  const user2 = { email: 'test2@gmail.com', firstName: 'Test2', lastName: 'Test', password: 'testtest' };
  let pool: Pool;
  let token1: string;
  let token2: string;
  let groupId: string;
  let tripId: string;
  let memberId1: string;
  let memberId2: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user1.email, user2.email]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user1.email, user2.email]);
      await pool.end();
    }
    await closePool();
  });

  it('creates two users and shares a trip', async () => {
    const reg1 = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: user1.firstName, lastName: user1.lastName, email: user1.email, password: user1.password })
      .expect(201);
    token1 = reg1.body.token as string;

    const groups1 = await request(app).get('/api/groups').set('Authorization', `Bearer ${token1}`).expect(200);
    groupId = groups1.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: 'Test Trip', groupId })
      .expect(201);
    tripId = trip.body.id as string;
    expect(tripId).toBeTruthy();

    const reg2 = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: user2.firstName, lastName: user2.lastName, email: user2.email, password: user2.password })
      .expect(201);
    token2 = reg2.body.token as string;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ email: user2.email })
      .expect(201);

    const groups1After = await request(app).get('/api/groups').set('Authorization', `Bearer ${token1}`).expect(200);
    const ownerMembers = groups1After.body[0]?.members ?? [];
    expect(ownerMembers.some((m: any) => (m.userEmail ?? m.email) === user2.email)).toBe(true);

    const groups2 = await request(app).get('/api/groups').set('Authorization', `Bearer ${token2}`).expect(200);
    expect(groups2.body.some((g: any) => g.id === groupId)).toBe(true);

    const trips2 = await request(app).get('/api/trips').set('Authorization', `Bearer ${token2}`).expect(200);
    expect(trips2.body.some((t: any) => t.id === tripId)).toBe(true);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token1}`).expect(200);
    memberId1 = members.body.find((m: any) => (m.email ?? m.userEmail) === user1.email)?.id;
    memberId2 = members.body.find((m: any) => (m.email ?? m.userEmail) === user2.email)?.id;
    expect(memberId1).toBeTruthy();
    expect(memberId2).toBeTruthy();
  });

  it('splits lodging cost evenly across payers', async () => {
    expect(token1).toBeTruthy();
    expect(memberId1).toBeTruthy();
    expect(memberId2).toBeTruthy();

    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        tripId,
        name: 'Test lodging 1',
        checkInDate: '2025-01-01',
        checkOutDate: '2025-01-02',
        rooms: 1,
        refundBy: null,
        totalCost: 500,
        costPerNight: 500,
        address: '123 Test St',
        paidBy: [memberId1, memberId2],
      })
      .expect(201);

    const lodgings = await request(app).get(`/api/lodgings?tripId=${tripId}`).set('Authorization', `Bearer ${token1}`).expect(200);
    expect(lodgings.body.length).toBeGreaterThan(0);
    const lodging = lodgings.body.find((l: any) => l.name === 'Test lodging 1');
    expect(lodging).toBeTruthy();
    expect(Array.isArray(lodging.paidBy)).toBe(true);
    expect(lodging.paidBy).toEqual(expect.arrayContaining([memberId1, memberId2]));
    const total = Number(lodging.totalCost ?? lodging.total_cost);
    expect(total).toBe(500);
    const share = total / lodging.paidBy.length;
    expect(share).toBe(250);
  });

  it('assigns single-payer lodging and totals reflect 250/750 split', async () => {
    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        tripId,
        name: 'Test lodging 2',
        checkInDate: '2025-01-03',
        checkOutDate: '2025-01-04',
        rooms: 1,
        refundBy: null,
        totalCost: 500,
        costPerNight: 500,
        address: '456 Test St',
        paidBy: [memberId2],
      })
      .expect(201);

    const lodgings = await request(app).get(`/api/lodgings?tripId=${tripId}`).set('Authorization', `Bearer ${token1}`).expect(200);
    const payerTotals: Record<string, number> = { [memberId1]: 0, [memberId2]: 0 };
    lodgings.body.forEach((l: any) => {
      const payers: string[] = Array.isArray(l.paidBy) ? l.paidBy : [];
      const cost = Number(l.totalCost ?? l.total_cost ?? 0);
      if (!cost || !payers.length) return;
      const share = cost / payers.length;
      payers.forEach((p) => {
        payerTotals[p] = (payerTotals[p] ?? 0) + share;
      });
      const remainder = cost - share * payers.length;
      if (Math.abs(remainder) > 1e-6 && payers[0]) {
        payerTotals[payers[0]] += remainder;
      }
    });

    expect(payerTotals[memberId1]).toBeCloseTo(250); // first lodging split half
    expect(payerTotals[memberId2]).toBeCloseTo(750); // half from first + full second
  });

  it('adjusts totals when payers are added and removed on a lodging', async () => {
    // Add third lodging with both payers
    const lodgingRes = await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        tripId,
        name: 'Test lodging 3',
        checkInDate: '2025-01-05',
        checkOutDate: '2025-01-06',
        rooms: 1,
        refundBy: null,
        totalCost: 500,
        costPerNight: 500,
        address: '789 Test St',
        paidBy: [memberId1, memberId2],
      })
      .expect(201);
    const lodgingId = lodgingRes.body.id;
    expect(lodgingId).toBeTruthy();

    const computeTotals = async () => {
      const lodgings = await request(app)
        .get(`/api/lodgings?tripId=${tripId}`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);
      const totals: Record<string, number> = { [memberId1]: 0, [memberId2]: 0 };
      lodgings.body.forEach((l: any) => {
        const payers: string[] = Array.isArray(l.paidBy) ? l.paidBy : [];
        const cost = Number(l.totalCost ?? l.total_cost ?? 0);
        if (!cost || !payers.length) return;
        const share = cost / payers.length;
        payers.forEach((p) => {
          totals[p] = (totals[p] ?? 0) + share;
        });
        const remainder = cost - share * payers.length;
        if (Math.abs(remainder) > 1e-6 && payers[0]) {
          totals[payers[0]] += remainder;
        }
      });
      return totals;
    };

    // After adding third lodging (both payers), totals should be 500 / 1000
    let totals = await computeTotals();
    expect(totals[memberId1]).toBeCloseTo(500);
    expect(totals[memberId2]).toBeCloseTo(1000);

    // Remove user2 from the third lodging
    await request(app)
      .patch(`/api/lodgings/${lodgingId}`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ paidBy: [memberId1] })
      .expect(200);
    totals = await computeTotals();
    expect(totals[memberId1]).toBeCloseTo(750);
    expect(totals[memberId2]).toBeCloseTo(750);

    // Remove user1 as well (explicit empty payer list) and totals should remain 750/750
    await request(app)
      .patch(`/api/lodgings/${lodgingId}`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ paidBy: [] })
      .expect(200);
    totals = await computeTotals();
    expect(totals[memberId1]).toBeCloseTo(750);
    expect(totals[memberId2]).toBeCloseTo(750);
  });

  it('adds first tour split evenly between payers', async () => {
    const tourRes = await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        tripId,
        date: '2025-02-01',
        name: 'Tour 1',
        startLocation: 'Test Place',
        startTime: '10:00',
        duration: '2h',
        cost: 500,
        freeCancelBy: null,
        bookedOn: 'Web',
        reference: 'T1',
        paidBy: [memberId1, memberId2],
      })
      .expect(201);
    expect(tourRes.body.id).toBeTruthy();

    const tours = await request(app).get(`/api/tours?tripId=${tripId}`).set('Authorization', `Bearer ${token1}`).expect(200);
    const totals = { [memberId1]: 0, [memberId2]: 0 };
    tours.body.forEach((t: any) => {
      const payers: string[] = Array.isArray(t.paidBy) ? t.paidBy : [];
      const cost = Number(t.cost ?? 0);
      if (!cost || !payers.length) return;
      const share = cost / payers.length;
      payers.forEach((p) => {
        totals[p] = (totals[p] ?? 0) + share;
      });
      const remainder = cost - share * payers.length;
      if (Math.abs(remainder) > 1e-6 && payers[0]) {
        totals[payers[0]] += remainder;
      }
    });

    expect(totals[memberId1]).toBeCloseTo(250);
    expect(totals[memberId2]).toBeCloseTo(250);
  });

  it('adds second tour with single payer and verifies totals', async () => {
    await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        tripId,
        date: '2025-02-02',
        name: 'Tour 2',
        startLocation: 'Test Place 2',
        startTime: '12:00',
        duration: '2h',
        cost: 500,
        freeCancelBy: null,
        bookedOn: 'Web',
        reference: 'T2',
        paidBy: [memberId2],
      })
      .expect(201);

    const tours = await request(app).get(`/api/tours?tripId=${tripId}`).set('Authorization', `Bearer ${token1}`).expect(200);
    const totals = { [memberId1]: 0, [memberId2]: 0 };
    tours.body.forEach((t: any) => {
      const payers: string[] = Array.isArray(t.paidBy) ? t.paidBy : [];
      const cost = Number(t.cost ?? 0);
      if (!cost || !payers.length) return;
      const share = cost / payers.length;
      payers.forEach((p) => {
        totals[p] = (totals[p] ?? 0) + share;
      });
      const remainder = cost - share * payers.length;
      if (Math.abs(remainder) > 1e-6 && payers[0]) {
        totals[payers[0]] += remainder;
      }
    });

    expect(totals[memberId1]).toBeCloseTo(250);
    expect(totals[memberId2]).toBeCloseTo(750);
  });

  it('adds third tour, then removes payers to match lodging logic', async () => {
    const tourRes = await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${token1}`)
      .send({
        tripId,
        date: '2025-02-03',
        name: 'Tour 3',
        startLocation: 'Test Place 3',
        startTime: '14:00',
        duration: '2h',
        cost: 500,
        freeCancelBy: null,
        bookedOn: 'Web',
        reference: 'T3',
        paidBy: [memberId1, memberId2],
      })
      .expect(201);
    const tourId = tourRes.body.id;
    expect(tourId).toBeTruthy();

    const computeTourTotals = async () => {
      const tours = await request(app).get(`/api/tours?tripId=${tripId}`).set('Authorization', `Bearer ${token1}`).expect(200);
      const totals = { [memberId1]: 0, [memberId2]: 0 };
      tours.body.forEach((t: any) => {
        const payers: string[] = Array.isArray(t.paidBy) ? t.paidBy : [];
        const cost = Number(t.cost ?? 0);
        if (!cost || !payers.length) return;
        const share = cost / payers.length;
        payers.forEach((p) => {
          totals[p] = (totals[p] ?? 0) + share;
        });
        const remainder = cost - share * payers.length;
        if (Math.abs(remainder) > 1e-6 && payers[0]) {
          totals[payers[0]] += remainder;
        }
      });
      return totals;
    };

    let totals = await computeTourTotals();
    expect(totals[memberId1]).toBeCloseTo(500);
    expect(totals[memberId2]).toBeCloseTo(1000);

    await request(app)
      .patch(`/api/tours/${tourId}`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ paidBy: [memberId1] })
      .expect(200);
    totals = await computeTourTotals();
    expect(totals[memberId1]).toBeCloseTo(750);
    expect(totals[memberId2]).toBeCloseTo(750);

    await request(app)
      .patch(`/api/tours/${tourId}`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ paidBy: [] })
      .expect(200);
    totals = await computeTourTotals();
    expect(totals[memberId1]).toBeCloseTo(750);
    expect(totals[memberId2]).toBeCloseTo(750);
  });

  it('keeps trip after deleting first user', async () => {
    await request(app).delete('/api/account').set('Authorization', `Bearer ${token1}`).expect(204);
    const user1Check = await pool.query('SELECT 1 FROM users WHERE email = $1', [user1.email]);
    expect(user1Check.rowCount).toBe(0);
    const tripStillThere = await pool.query('SELECT 1 FROM trips WHERE id = $1', [tripId]);
    expect(tripStillThere.rowCount).toBe(1);

    const trips2After = await request(app).get('/api/trips').set('Authorization', `Bearer ${token2}`).expect(200);
    expect(trips2After.body.some((t: any) => t.id === tripId)).toBe(true);
  });

  it('removes trip after deleting last user', async () => {
    await request(app).delete('/api/account').set('Authorization', `Bearer ${token2}`).expect(204);
    const user2Check = await pool.query('SELECT 1 FROM users WHERE email = $1', [user2.email]);
    expect(user2Check.rowCount).toBe(0);
    const tripGone = await pool.query('SELECT 1 FROM trips WHERE id = $1', [tripId]);
    expect(tripGone.rowCount).toBe(0);
  });
});
