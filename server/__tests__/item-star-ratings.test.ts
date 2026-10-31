/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, getStarRatingSummaries, initDb, insertCarRental, insertFlight, insertLodging } from '../src/db';
import { providerKeyFor } from '../src/services/itemRatingService';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

describe('1-5 star ratings, averaged per provider across travelers', () => {
  const uniq = Date.now();
  type Traveler = { userId: string; token: string; tripId: string };
  let alice: Traveler;
  let bob: Traveler;

  const traveler = async (name: string): Promise<Traveler> => {
    const user = await registerAndLoginWebUser({ email: `stars-${name}+${uniq}@example.com`, firstName: name, lastName: 'Rater', password: 'testtest' });
    await setUserTierInDb(user.userId, 'premium');
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${user.token}`).expect(200);
    const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${user.token}`)
      .send({ name: `${name} stars ${uniq}`, groupId: groups.body[0].id }).expect(201);
    return { userId: user.userId, token: user.token, tripId: trip.body.id };
  };
  const lodgingFor = (who: Traveler, name: string, status = 'Completed') => insertLodging({
    userId: who.userId, tripId: who.tripId, status, name, checkInDate: '2026-03-01', checkOutDate: '2026-03-04', rooms: 1, totalCost: 0, costPerNight: 0, address: '', paid_by: [], traveler_ids: [],
  } as any);
  const rate = (who: Traveler, id: string, value: unknown) =>
    request(app).post(`/api/lodgings/${id}/rating`).set('Authorization', `Bearer ${who.token}`).send({ value });
  const listed = async (who: Traveler, id: string) => {
    const res = await request(app).get(`/api/lodgings?tripId=${who.tripId}`).set('Authorization', `Bearer ${who.token}`).expect(200);
    return res.body.find((item: any) => item.id === id);
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    alice = await traveler('Alice');
    bob = await traveler('Bob');
  });

  afterAll(async () => {
    await closePool();
  });

  it('averages every traveler\'s rating of the same hotel, and shows each traveler their own stars', async () => {
    const hotel = `Grand Hotel ${uniq}`;
    const aliceStay = await lodgingFor(alice, hotel);
    const bobStay = await lodgingFor(bob, `  ${hotel.toUpperCase()} `);

    expect(await listed(alice, aliceStay.id)).toMatchObject({ averageRating: null, userRating: null });

    expect((await rate(alice, aliceStay.id, 5).expect(200)).body).toEqual({ itemId: aliceStay.id, averageRating: 5, userRating: 5 });
    expect((await rate(bob, bobStay.id, 2).expect(200)).body).toEqual({ itemId: bobStay.id, averageRating: 3.5, userRating: 2 });

    // Partial averages come through, and each traveler sees their own stars next to the shared average.
    expect(await listed(alice, aliceStay.id)).toMatchObject({ averageRating: 3.5, userRating: 5 });
    expect(await listed(bob, bobStay.id)).toMatchObject({ averageRating: 3.5, userRating: 2 });
    // A provider's rating is visible on its other bookings too, including ones not yet rated.
    const another = await lodgingFor(alice, hotel, 'Booked');
    expect(await listed(alice, another.id)).toMatchObject({ averageRating: 3.5, userRating: null });
  });

  it('lets a traveler change their rating: one vote each, the average follows, the count and change date stay internal', async () => {
    const hotel = `Changing Inn ${uniq}`;
    const stay = await lodgingFor(alice, hotel);
    const providerKey = providerKeyFor('lodging', { id: stay.id, name: hotel });

    await rate(alice, stay.id, 1).expect(200);
    const before = await getStarRatingSummaries(alice.userId, 'lodging', [{ itemId: stay.id, providerKey }]);
    expect(before[stay.id]).toEqual({ average: 1, count: 1, userStars: 1 });

    const changed = (await rate(alice, stay.id, 4).expect(200)).body;
    expect(changed).toEqual({ itemId: stay.id, averageRating: 4, userRating: 4 });
    expect(changed).not.toHaveProperty('ratingCount');
    expect(changed).not.toHaveProperty('updatedAt');
    const after = await getStarRatingSummaries(alice.userId, 'lodging', [{ itemId: stay.id, providerKey }]);
    expect(after[stay.id]).toEqual({ average: 4, count: 1, userStars: 4 });
  });

  it('only takes whole stars from 1 to 5 on completed items by trip members', async () => {
    const stay = await lodgingFor(alice, `Strict Stay ${uniq}`);
    for (const bad of [0, 6, 2.5, 'x', null]) await rate(alice, stay.id, bad).expect(400);
    await rate(bob, stay.id, 3).expect(403);
    const notYet = await lodgingFor(alice, `Future Stay ${uniq}`, 'Booked');
    await rate(alice, notYet.id, 3).expect(400);
  });

  it('keeps airlines, rental companies and unnamed bookings apart', async () => {
    const flight = await insertFlight({
      userId: alice.userId, tripId: alice.tripId, status: 'Completed', transferType: 'Flight', passengerName: 'A', departureDate: '2026-03-03', arrivalDate: '2026-03-03',
      departureTime: '09:00', arrivalTime: '11:00', cost: 0, carrier: `Skyline ${uniq}`, flightNumber: '1', bookingReference: 'R',
    } as any);
    const rental = await insertCarRental({
      userId: alice.userId, tripId: alice.tripId, status: 'Completed', pickupLocation: 'A', pickupDate: '2026-03-01', dropoffLocation: 'B', dropoffDate: '2026-03-04',
      reference: '', vendor: `Skyline ${uniq}`, prepaid: '', cost: 0, model: '', notes: '', paidBy: [], travelerIds: [],
    } as any);
    await request(app).post(`/api/transfers/${flight.id}/rating`).set('Authorization', `Bearer ${alice.token}`).send({ value: 4 }).expect(200);
    const rentalRes = await request(app).post(`/api/car-rentals/${rental.id}/rating`).set('Authorization', `Bearer ${alice.token}`).send({ value: '2' }).expect(200);
    expect(rentalRes.body).toEqual({ itemId: rental.id, averageRating: 2, userRating: 2 });

    expect(providerKeyFor('flight', { id: 'f', carrier: '' })).toBe('item:f');
    expect(providerKeyFor('activity', { id: 'a', name: 'Louvre', catalogId: 'CAT-1' })).toBe('catalog:cat-1');
    expect(providerKeyFor('lodging', { id: 'l', name: 'X', placeId: 'ChIJ1' })).toBe('place:chij1');
  });
});
