import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';

describe('Cost report calculations across lodging, tours, and flights', () => {
  const uniq = Date.now();
  const userA = { email: `cost-a+${uniq}@example.com`, firstName: 'CostA', lastName: 'Tester', password: 'testtest' };
  const userB = { email: `cost-b+${uniq}@example.com`, firstName: 'CostB', lastName: 'Tester', password: 'testtest' };
  let pool: Pool;
  let tokenA: string;
  let tokenB: string;
  let groupId: string;
  let tripId: string;
  let memberA: string;
  let memberB: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Register users (unique emails avoid collision; no deletion afterward)
    const regA = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: userA.firstName, lastName: userA.lastName, email: userA.email, password: userA.password, passwordConfirm: userA.password })
      .expect(201);
    tokenA = regA.body.token as string;

    const groupsA = await request(app).get('/api/groups').set('Authorization', `Bearer ${tokenA}`).expect(200);
    groupId = groupsA.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `Cost Trip ${uniq}`, groupId })
      .expect(201);
    tripId = trip.body.id as string;

    const regB = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: userB.firstName, lastName: userB.lastName, email: userB.email, password: userB.password, passwordConfirm: userB.password })
      .expect(201);
    tokenB = regB.body.token as string;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: userB.email })
      .expect(201);

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    memberA = members.body.find((m: any) => (m.email ?? m.userEmail) === userA.email)?.id;
    memberB = members.body.find((m: any) => (m.email ?? m.userEmail) === userB.email)?.id;
    expect(memberA).toBeTruthy();
    expect(memberB).toBeTruthy();
  });

  afterAll(async () => {
    await pool.end();
    await closePool();
  });

  const accumulate = (items: any[], getCost: (i: any) => number, getPayers: (i: any) => string[]) => {
    const totals: Record<string, number> = { [memberA]: 0, [memberB]: 0 };
    items.forEach((it) => {
      const payers = getPayers(it);
      const cost = getCost(it);
      if (!cost || !payers.length) return;
      const share = cost / payers.length;
      payers.forEach((p) => {
        totals[p] = (totals[p] ?? 0) + share;
      });
      const remainder = cost - share * payers.length;
      if (Math.abs(remainder) > 1e-6 && payers[0]) totals[payers[0]] += remainder;
    });
    return totals;
  };

  it('lodging: shared, single, then payer removal matches expected splits', async () => {
    // lodging 1 split
    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        name: 'CR lodging 1',
        checkInDate: '2025-04-01',
        checkOutDate: '2025-04-02',
        rooms: 1,
        totalCost: 500,
        costPerNight: 500,
        paidBy: [memberA, memberB],
      })
      .expect(201);

    // lodging 2 single payer
    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        name: 'CR lodging 2',
        checkInDate: '2025-04-03',
        checkOutDate: '2025-04-04',
        rooms: 1,
        totalCost: 500,
        costPerNight: 500,
        paidBy: [memberB],
      })
      .expect(201);

    // lodging 3 both -> then remove payers
    const lodging3 = await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        name: 'CR lodging 3',
        checkInDate: '2025-04-05',
        checkOutDate: '2025-04-06',
        rooms: 1,
        totalCost: 500,
        costPerNight: 500,
        paidBy: [memberA, memberB],
      })
      .expect(201);
    const lodging3Id = lodging3.body.id as string;

    let lodgings = await request(app).get(`/api/lodgings?tripId=${tripId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    let totals = accumulate(
      lodgings.body,
      (l) => Number(l.totalCost ?? l.total_cost ?? 0),
      (l) => (Array.isArray(l.paidBy) ? l.paidBy : [])
    );
    expect(totals[memberA]).toBeCloseTo(500);
    expect(totals[memberB]).toBeCloseTo(1000);

    await request(app).patch(`/api/lodgings/${lodging3Id}`).set('Authorization', `Bearer ${tokenA}`).send({ paidBy: [memberA] }).expect(200);
    lodgings = await request(app).get(`/api/lodgings?tripId=${tripId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    totals = accumulate(
      lodgings.body,
      (l) => Number(l.totalCost ?? l.total_cost ?? 0),
      (l) => (Array.isArray(l.paidBy) ? l.paidBy : [])
    );
    expect(totals[memberA]).toBeCloseTo(750);
    expect(totals[memberB]).toBeCloseTo(750);

    await request(app).patch(`/api/lodgings/${lodging3Id}`).set('Authorization', `Bearer ${tokenA}`).send({ paidBy: [] }).expect(200);
    lodgings = await request(app).get(`/api/lodgings?tripId=${tripId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    totals = accumulate(
      lodgings.body,
      (l) => Number(l.totalCost ?? l.total_cost ?? 0),
      (l) => (Array.isArray(l.paidBy) ? l.paidBy : [])
    );
    expect(totals[memberA]).toBeCloseTo(750);
    expect(totals[memberB]).toBeCloseTo(750);
  });

  it('tours: shared, single, then payer removal matches expected splits', async () => {
    const tour3 = await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        date: '2025-05-01',
        name: 'CR tour 1',
        startLocation: 'Loc1',
        startTime: '10:00',
        duration: '2h',
        cost: 500,
        paidBy: [memberA, memberB],
        bookedOn: 'Web',
        reference: 'CR1',
      })
      .expect(201);

    await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        date: '2025-05-02',
        name: 'CR tour 2',
        startLocation: 'Loc2',
        startTime: '12:00',
        duration: '2h',
        cost: 500,
        paidBy: [memberB],
        bookedOn: 'Web',
        reference: 'CR2',
      })
      .expect(201);

    const tour3Res = await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        date: '2025-05-03',
        name: 'CR tour 3',
        startLocation: 'Loc3',
        startTime: '14:00',
        duration: '2h',
        cost: 500,
        paidBy: [memberA, memberB],
        bookedOn: 'Web',
        reference: 'CR3',
      })
      .expect(201);
    const tour3Id = tour3Res.body.id as string;

    const computeTours = async () => {
      const tours = await request(app).get(`/api/tours?tripId=${tripId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      return accumulate(
        tours.body,
        (t) => Number(t.cost ?? 0),
        (t) => (Array.isArray(t.paidBy) ? t.paidBy : [])
      );
    };

    let totals = await computeTours();
    expect(totals[memberA]).toBeCloseTo(500);
    expect(totals[memberB]).toBeCloseTo(1000);

    await request(app).patch(`/api/tours/${tour3Id}`).set('Authorization', `Bearer ${tokenA}`).send({ paidBy: [memberA] }).expect(200);
    totals = await computeTours();
    expect(totals[memberA]).toBeCloseTo(750);
    expect(totals[memberB]).toBeCloseTo(750);

    await request(app).patch(`/api/tours/${tour3Id}`).set('Authorization', `Bearer ${tokenA}`).send({ paidBy: [] }).expect(200);
    totals = await computeTours();
    expect(totals[memberA]).toBeCloseTo(750);
    expect(totals[memberB]).toBeCloseTo(750);
  });

  it('flights: shared, single, then payer removal matches expected splits', async () => {
    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        passengerName: 'CR Passenger 1',
        departureDate: '2025-06-01',
        departureLocation: 'AAA',
        departureTime: '08:00',
        arrivalLocation: 'BBB',
        arrivalTime: '10:00',
        cost: 500,
        carrier: 'AA',
        flightNumber: 'C1',
        bookingReference: 'CRF1',
        passengerIds: [memberA],
        paidBy: [memberA, memberB],
      })
      .expect(201);

    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        passengerName: 'CR Passenger 2',
        departureDate: '2025-06-02',
        departureLocation: 'AAA',
        departureTime: '09:00',
        arrivalLocation: 'BBB',
        arrivalTime: '11:00',
        cost: 500,
        carrier: 'AA',
        flightNumber: 'C2',
        bookingReference: 'CRF2',
        passengerIds: [memberB],
        paidBy: [memberB],
      })
      .expect(201);

    const flight3 = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        tripId,
        passengerName: 'CR Passenger 3',
        departureDate: '2025-06-03',
        departureLocation: 'AAA',
        departureTime: '07:00',
        arrivalLocation: 'BBB',
        arrivalTime: '09:00',
        cost: 500,
        carrier: 'AA',
        flightNumber: 'C3',
        bookingReference: 'CRF3',
        passengerIds: [memberA, memberB],
        paidBy: [memberA, memberB],
      })
      .expect(201);
    const flight3Id = flight3.body.id as string;

    const computeFlights = async () => {
      const flights = await request(app).get(`/api/flights?tripId=${tripId}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
      return accumulate(
        flights.body,
        (f) => Number(f.cost ?? 0),
        (f) => (Array.isArray(f.paidBy) ? f.paidBy : [])
      );
    };

    let totals = await computeFlights();
    expect(totals[memberA]).toBeCloseTo(500);
    expect(totals[memberB]).toBeCloseTo(1000);

    await request(app).patch(`/api/flights/${flight3Id}`).set('Authorization', `Bearer ${tokenA}`).send({ paidBy: [memberA] }).expect(200);
    totals = await computeFlights();
    expect(totals[memberA]).toBeCloseTo(750);
    expect(totals[memberB]).toBeCloseTo(750);

    await request(app).patch(`/api/flights/${flight3Id}`).set('Authorization', `Bearer ${tokenA}`).send({ paidBy: [] }).expect(200);
    totals = await computeFlights();
    expect(totals[memberA]).toBeCloseTo(750);
    expect(totals[memberB]).toBeCloseTo(750);
  });
});
