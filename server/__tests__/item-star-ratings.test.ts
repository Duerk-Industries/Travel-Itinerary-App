/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { castItemVote, closePool, getStarRatingSummaries, initDb, insertCarRental, insertFlight, insertLodging, listLegacyThumbRatings } from '../src/db';
import { providerKeyFor } from '../src/services/itemRatingService';
import { convertThumbRatingsToStars } from '../src/services/thumbRatingConversionService';
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
  });

  it('matches hotels by name and address, else name and trip destination, else name alone', () => {
    const at = (address: string) => providerKeyFor('lodging', { id: 'l', name: 'Hotel  Lux!', address });
    expect(at('1 Main St., Paris')).toBe(at(' 1 main st paris '));
    expect(at('1 Main St, Paris')).not.toBe(at('9 Quay Rd, Nice'));
    expect(providerKeyFor('lodging', { id: 'l', name: 'Hotel Lux', address: '' }, { destination: 'Paris, France' })).toBe('hotel:hotel lux|in paris france');
    expect(providerKeyFor('lodging', { id: 'l', name: 'Hotel Lux', address: '' }, { destination: 'Nice' })).not.toBe(
      providerKeyFor('lodging', { id: 'l', name: 'Hotel Lux', address: '' }, { destination: 'Paris' })
    );
    // An address wins over the destination, and with neither the name alone is averaged.
    expect(providerKeyFor('lodging', { id: 'l', name: 'Hotel Lux', address: '1 Main St' }, { destination: 'Paris' })).toBe('hotel:hotel lux|1 main st');
    expect(providerKeyFor('lodging', { id: 'l', name: 'Hotel Lux' })).toBe('hotel:hotel lux');
    expect(providerKeyFor('lodging', { id: 'l', name: '  ' })).toBe('item:l');
  });

  it('keeps same-named hotels at different addresses apart when averaging', async () => {
    const hotel = `Twin Inn ${uniq}`;
    const stayAt = (who: Traveler, address: string) => insertLodging({
      userId: who.userId, tripId: who.tripId, status: 'Completed', name: hotel, checkInDate: '2026-03-01', checkOutDate: '2026-03-04', rooms: 1, totalCost: 0, costPerNight: 0, address, paid_by: [], traveler_ids: [],
    } as any);
    const north = await stayAt(alice, '1 North Rd');
    const northToo = await stayAt(bob, '1 north rd.');
    const south = await stayAt(alice, '2 South Rd');
    await rate(alice, north.id, 5).expect(200);
    expect((await rate(bob, northToo.id, 3).expect(200)).body).toMatchObject({ averageRating: 4, userRating: 3 });
    expect(await listed(alice, south.id)).toMatchObject({ averageRating: null, userRating: null });
  });

  it('converts old thumb ratings once: up is 5 stars, down is 1, an existing star rating is kept', async () => {
    const liked = await lodgingFor(alice, `Thumb Up ${uniq}`);
    const disliked = await lodgingFor(alice, `Thumb Down ${uniq}`);
    const alreadyStarred = await lodgingFor(alice, `Both ${uniq}`);
    await castItemVote(alice.userId, alice.tripId, 'lodging', liked.id, 1, 'rating');
    await castItemVote(alice.userId, alice.tripId, 'lodging', disliked.id, -1, 'rating');
    await castItemVote(alice.userId, alice.tripId, 'lodging', alreadyStarred.id, -1, 'rating');
    await rate(alice, alreadyStarred.id, 4).expect(200);

    expect(await convertThumbRatingsToStars()).toBe(2);
    expect(await listed(alice, liked.id)).toMatchObject({ averageRating: 5, userRating: 5 });
    expect(await listed(alice, disliked.id)).toMatchObject({ averageRating: 1, userRating: 1 });
    expect(await listed(alice, alreadyStarred.id)).toMatchObject({ userRating: 4 });
    expect(await listLegacyThumbRatings()).toEqual([]);
    expect(await convertThumbRatingsToStars()).toBe(0);
  });
});
