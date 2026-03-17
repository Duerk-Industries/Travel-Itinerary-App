import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

type Rng = () => number;

const createSeededRng = (seed: number): Rng => {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
};

const pickSubset = (ids: string[], rng: Rng): string[] => {
  if (!ids.length) return [];
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const count = Math.max(1, Math.floor(rng() * shuffled.length) + 1);
  return shuffled.slice(0, count);
};

describe('Ledger integration data setup', () => {
  const uniq = Date.now();
  const user = { email: `ledger+${uniq}@example.com`, firstName: 'Ledger', lastName: 'Owner', password: 'testtest' };
  let token: string;
  let tripId: string;
  let groupId: string;
  let memberIds: string[];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();

    const login = await registerAndLoginWebUser(user);
    token = login.token;
    await setUserTierInDb(login.userId, 'premium');

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    for (const [idx, name] of ['Alex', 'Blair', 'Casey'].entries()) {
      await request(app)
        .post(`/api/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: name, lastName: `Traveler${idx}` })
        .expect(201);
    }

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Ledger Trip ${uniq}`, groupId, currency: 'USD' })
      .expect(201);
    tripId = trip.body.id as string;
    expect(tripId).toBeTruthy();

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token}`).expect(200);
    memberIds = members.body.map((m: any) => String(m.id));
    expect(memberIds).toHaveLength(4);
  });

  afterAll(async () => {
    await closePool();
  });

  it('creates a full data set with deterministic traveler/payer selections', async () => {
    const rng = createSeededRng(4242);
    const pickTravelers = () => pickSubset(memberIds, rng);
    const pickPayers = () => pickSubset(memberIds, rng);

    const passengerIds = pickTravelers();
    const paidByFlight = pickPayers();
    await request(app)
      .post('/api/transfers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        passengerIds,
        departureDate: '2026-02-01',
        departureTime: '08:00',
        arrivalTime: '12:00',
        cost: 320,
        carrier: 'TestAir',
        flightNumber: 'TA123',
        bookingReference: 'BOOK123',
        paidBy: paidByFlight,
      })
      .expect(201);

    const lodgingTravelers = pickTravelers();
    const lodgingPayers = pickPayers();
    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        name: 'Hotel Test',
        checkInDate: '2026-02-02',
        checkOutDate: '2026-02-05',
        rooms: 2,
        refundBy: '',
        totalCost: 600,
        costPerNight: 100,
        address: '123 Test St',
        paidBy: lodgingPayers,
        travelerIds: lodgingTravelers,
      })
      .expect(201);

    const tourTravelers = pickTravelers();
    const tourPayers = pickPayers();
    await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        date: '2026-02-03',
        name: 'City Tour',
        startLocation: 'Downtown',
        startTime: '10:00',
        duration: '2h',
        cost: 150,
        bookedOn: '2026-01-10',
        reference: 'TOUR-1',
        paidBy: tourPayers,
        travelerIds: tourTravelers,
      })
      .expect(201);

    const rentalPayers = pickPayers();
    const rentalTravelers = pickTravelers();
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        expenseDate: '2026-02-02',
        category: 'Car Rentals',
        amount: 180,
        currency: 'USD',
        payerIds: rentalPayers,
        forIds: rentalTravelers,
      })
      .expect(201);

    const dailyCategories = ['Breakfast', 'Lunch', 'Dinner', 'Other Food', 'Rides', 'Souvenirs', 'Other'];
    for (const category of dailyCategories) {
      await request(app)
        .post('/api/expenses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tripId,
          expenseDate: '2026-02-03',
          category,
          amount: Math.round(rng() * 90 + 10),
          currency: 'USD',
          payerIds: pickPayers(),
          forIds: pickTravelers(),
        })
        .expect(201);
    }

    const list = await request(app)
      .get(`/api/expenses?tripId=${tripId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThanOrEqual(11);
    list.body.forEach((expense: any) => {
      expect(Array.isArray(expense.payerIds)).toBe(true);
      expect(Array.isArray(expense.forIds)).toBe(true);
      expect(expense.payerIds.length).toBeGreaterThan(0);
      expect(expense.forIds.length).toBeGreaterThan(0);
    });
  });
});

