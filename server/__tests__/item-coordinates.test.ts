/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, insertActivity, insertCarRental, insertLodging, listActivities, listCarRentals, listLodgings, setItemCoordinates } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

describe('setItemCoordinates (restoring coordinates from an imported printout)', () => {
  const uniq = Date.now();
  let userId: string;
  let outsiderId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    const owner = await registerAndLoginWebUser({ email: `coords-a+${uniq}@example.com`, firstName: 'Coords', lastName: 'Owner', password: 'testtest' });
    userId = owner.userId;
    await setUserTierInDb(userId, 'premium');
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${owner.token}`).expect(200);
    const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: `Coordinates Trip ${uniq}`, groupId: groups.body[0].id }).expect(201);
    tripId = trip.body.id;
    const outsider = await registerAndLoginWebUser({ email: `coords-b+${uniq}@example.com`, firstName: 'Coords', lastName: 'Outsider', password: 'testtest' });
    outsiderId = outsider.userId;
  });

  afterAll(async () => {
    await closePool();
  });

  it('stores coordinates and their source on a lodging, an activity and a car rental', async () => {
    const lodging = await insertLodging({ userId, tripId, status: 'Booked', name: 'Hotel Gracia', checkInDate: '2026-03-03', checkOutDate: '2026-03-06', rooms: 1, totalCost: 540, costPerNight: 180, address: 'Barcelona', paid_by: [], traveler_ids: [] });
    const activity = await insertActivity({ userId, tripId, status: 'Booked', activityType: 'Sights & Landmarks', date: '2026-03-03', name: 'Sagrada Familia', startLocation: 'Barcelona', startTime: '10:00', duration: '2h00', cost: 58, bookedOn: '', reference: '', notes: '', paidBy: [], travelerIds: [] });
    const rental = await insertCarRental({ userId, tripId, status: 'Proposed', pickupLocation: 'Barcelona Airport', pickupDate: '2026-03-04', dropoffLocation: 'Barcelona Sants', dropoffDate: '2026-03-05', reference: 'HZ-1', vendor: 'Hertz', prepaid: '', cost: 95, model: 'Fiat 500', notes: '', paidBy: [], travelerIds: [] });

    expect(await setItemCoordinates(userId, 'lodging', lodging.id, { lat: 41.4036, lng: 2.1744, coordinateSource: 'manual' })).toBe(true);
    expect(await setItemCoordinates(userId, 'activity', activity.id, { lat: 41.40363, lng: 2.17436, coordinateSource: 'catalog' })).toBe(true);
    expect(await setItemCoordinates(userId, 'car_rental', rental.id, { lat: 41.2974, lng: 2.0833, dropoffLat: 41.379, dropoffLng: 2.14, coordinateSource: 'geocoder' })).toBe(true);

    const savedLodging = (await listLodgings(userId, tripId)).find((item) => item.id === lodging.id)!;
    expect(savedLodging).toEqual(expect.objectContaining({ lat: 41.4036, lng: 2.1744, coordinateSource: 'manual' }));
    const savedActivity = (await listActivities(userId, tripId)).find((item) => item.id === activity.id)!;
    expect(savedActivity).toEqual(expect.objectContaining({ lat: 41.40363, lng: 2.17436, coordinateSource: 'catalog' }));
    const savedRental = (await listCarRentals(userId, tripId)).find((item) => item.id === rental.id)!;
    expect(savedRental).toEqual(expect.objectContaining({ lat: 41.2974, lng: 2.0833, dropoffLat: 41.379, dropoffLng: 2.14, coordinateSource: 'geocoder' }));
  });

  it('reports a missing item and refuses someone outside the trip', async () => {
    expect(await setItemCoordinates(userId, 'activity', 'does-not-exist', { lat: 1, lng: 2, coordinateSource: 'manual' })).toBe(false);
    expect(await setItemCoordinates(userId, 'lodging', '00000000-0000-4000-8000-000000000000', { lat: 1, lng: 2, coordinateSource: 'manual' })).toBe(false);
    const activity = await insertActivity({ userId, tripId, status: 'Proposed', activityType: 'Other', date: '2026-03-04', name: 'Private plan', startLocation: '', startTime: '', duration: '', cost: 0, bookedOn: '', reference: '', notes: '', paidBy: [], travelerIds: [] });
    await expect(setItemCoordinates(outsiderId, 'activity', activity.id, { lat: 1, lng: 2, coordinateSource: 'manual' })).rejects.toThrow(/not authorized/i);
    const unchanged = (await listActivities(userId, tripId)).find((item) => item.id === activity.id)!;
    expect(unchanged.lat ?? null).toBeNull();
  });
});
