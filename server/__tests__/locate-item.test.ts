/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, insertActivity, insertCarRental, insertLodging, listActivities, listCarRentals, listLodgings, setFeatureFlag, updateTripDetails } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';
import * as geocoder from '../src/services/geocoder';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

jest.mock('../src/services/geocoder', () => ({
  ...jest.requireActual('../src/services/geocoder'),
  geocoderConfigured: jest.fn(() => true),
  geocodeAddress: jest.fn(),
}));

const mockedGeocode = geocoder.geocodeAddress as jest.Mock;
const mockedConfigured = geocoder.geocoderConfigured as jest.Mock;

describe('POST /api/trips/:id/locate-item ("Find locations")', () => {
  const uniq = Date.now();
  let token: string;
  let outsiderToken: string;
  let userId: string;
  let tripId: string;
  let lodgingId: string;
  let fallbackLodgingId: string;
  let activityId: string;
  let bareActivityId: string;
  let rentalId: string;

  const locate = (body: Record<string, unknown>, auth = token) =>
    request(app).post(`/api/trips/${tripId}/locate-item`).set('Authorization', `Bearer ${auth}`).send(body);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    const owner = await registerAndLoginWebUser({ email: `locate-a+${uniq}@example.com`, firstName: 'Locate', lastName: 'Owner', password: 'testtest' });
    token = owner.token; userId = owner.userId;
    await setUserTierInDb(userId, 'premium');
    const outsider = await registerAndLoginWebUser({ email: `locate-b+${uniq}@example.com`, firstName: 'Locate', lastName: 'Outsider', password: 'testtest' });
    outsiderToken = outsider.token;
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`)
      .send({ name: `Locate Trip ${uniq}`, groupId: groups.body[0].id, destination: 'Japan', startDate: '2027-03-02', endDate: '2027-03-06' }).expect(201);
    tripId = trip.body.id;
    await updateTripDetails(userId, tripId, { destination: 'Japan' });

    const fallbackLodging = await insertLodging({ userId, tripId, status: 'Booked', name: 'Richmond Hotel Asakusa', checkInDate: '2027-03-02', checkOutDate: '2027-03-03', rooms: 1, totalCost: 10, costPerNight: 10, address: 'Tokyo-to, Tokyo, Taito-ku Asakusa 2-6-7, Japan', paid_by: [], traveler_ids: [] });
    fallbackLodgingId = fallbackLodging.id;
    const lodging = await insertLodging({ userId, tripId, status: 'Booked', name: 'Hotel Gracia', checkInDate: '2027-03-02', checkOutDate: '2027-03-06', rooms: 1, totalCost: 100, costPerNight: 25, address: 'Asakusa 2-6-7, Taito, Tokyo, Japan', paid_by: [], traveler_ids: [] });
    lodgingId = lodging.id;
    const activity = await insertActivity({ userId, tripId, status: 'Proposed', activityType: 'Other', date: '2027-03-03', name: 'Senso-ji', startLocation: '2-3-1 Asakusa, Taito City, Tokyo, Japan', startTime: '9:00', duration: '', cost: 0, bookedOn: '', reference: '', notes: '', paidBy: [], travelerIds: [] });
    activityId = activity.id;
    const bare = await insertActivity({ userId, tripId, status: 'Proposed', activityType: 'Other', date: '2027-03-03', name: 'Ameyoko', startLocation: 'Ameyoko', startTime: '', duration: '', cost: 0, bookedOn: '', reference: '', notes: '', paidBy: [], travelerIds: [] });
    bareActivityId = bare.id;
    const rental = await insertCarRental({ userId, tripId, status: 'Proposed', pickupLocation: 'Narita Airport', pickupDate: '2027-03-04', dropoffLocation: 'Haneda Airport', dropoffDate: '2027-03-05', reference: '', vendor: 'Toyota', prepaid: '', cost: 0, model: '', notes: '', paidBy: [], travelerIds: [] });
    rentalId = rental.id;
    await setFeatureFlag('planning_web_map', true, null);
  });

  beforeEach(async () => {
    mockedGeocode.mockReset();
    mockedConfigured.mockReturnValue(true);
    await setFeatureFlag('planning_locate_items', true, null);
    clearFeatureFlagCacheForTesting();
  });

  afterAll(async () => { await closePool(); });

  it('is off when the flag is off, and never reaches the provider', async () => {
    await setFeatureFlag('planning_locate_items', false, null);
    clearFeatureFlagCacheForTesting();
    const res = await locate({ kind: 'lodging', itemId: lodgingId });
    expect(res.status).toBe(404);
    expect(mockedGeocode).not.toHaveBeenCalled();
    const capabilities = await request(app).get(`/api/trips/${tripId}/planning-capabilities`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(capabilities.body.locate).toBe(false);
  });

  it('reports a missing key instead of failing mysteriously', async () => {
    mockedConfigured.mockReturnValue(false);
    const res = await locate({ kind: 'lodging', itemId: lodgingId });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NOT_CONFIGURED');
    expect(mockedGeocode).not.toHaveBeenCalled();
  });

  it('refuses people outside the trip and malformed requests', async () => {
    expect((await locate({ kind: 'lodging', itemId: lodgingId }, outsiderToken)).status).toBe(403);
    expect((await locate({ kind: 'flight', itemId: lodgingId })).status).toBe(400);
    expect((await locate({ kind: 'lodging', itemId: lodgingId, text: 'anything the client wants looked up' })).status).toBe(400);
    expect((await locate({ kind: 'lodging' })).status).toBe(400);
    expect(mockedGeocode).not.toHaveBeenCalled();
  });

  it('geocodes the saved address, stores it with its source, and will not overwrite it later', async () => {
    mockedGeocode.mockResolvedValue({ lat: 35.7148, lng: 139.7966, geoCity: 'Taito City', confidence: 0.9 });
    const res = await locate({ kind: 'lodging', itemId: lodgingId }).expect(200);
    expect(res.body).toEqual(expect.objectContaining({ status: 'located', lat: 35.7148, lng: 139.7966, provider: 'geoapify' }));
    expect(res.body.attribution).toMatch(/Geoapify/);
    expect(mockedGeocode).toHaveBeenCalledWith('Asakusa 2-6-7, Taito, Tokyo, Japan', { countryCode: 'jp' });
    const saved = (await listLodgings(userId, tripId)).find((item) => item.id === lodgingId)!;
    expect(saved).toEqual(expect.objectContaining({ lat: 35.7148, lng: 139.7966, coordinateSource: 'geocoder' }));

    mockedGeocode.mockClear();
    const again = await locate({ kind: 'lodging', itemId: lodgingId }).expect(200);
    expect(again.body.status).toBe('already_located');
    expect(mockedGeocode).not.toHaveBeenCalled();
  });

  it('adds the trip destination to a bare place name but not to a full address', async () => {
    mockedGeocode.mockResolvedValue({ lat: 35.71, lng: 139.77, geoCity: null, confidence: null });
    await locate({ kind: 'activity', itemId: bareActivityId }).expect(200);
    expect(mockedGeocode).toHaveBeenCalledWith('Ameyoko, Japan', { countryCode: 'jp' });
    expect(mockedGeocode).toHaveBeenCalledTimes(1);
    await locate({ kind: 'activity', itemId: activityId }).expect(200);
    expect(mockedGeocode).toHaveBeenLastCalledWith('2-3-1 Asakusa, Taito City, Tokyo, Japan', { countryCode: 'jp' });
    const activities = await listActivities(userId, tripId);
    expect(activities.find((item) => item.id === activityId)).toEqual(expect.objectContaining({ lat: 35.71, lng: 139.77, coordinateSource: 'geocoder' }));
  });

  it('searches by the place\'s name when its address has no confident match, and tells the provider the trip\'s country', async () => {
    mockedGeocode.mockResolvedValueOnce(null).mockResolvedValueOnce({ lat: 35.714, lng: 139.794, geoCity: 'Taito', confidence: 0.76, countryCode: 'jp' });
    const res = await locate({ kind: 'lodging', itemId: fallbackLodgingId }).expect(200);
    expect(res.body.status).toBe('located');
    expect(mockedGeocode).toHaveBeenNthCalledWith(1, 'Tokyo-to, Tokyo, Taito-ku Asakusa 2-6-7, Japan', { countryCode: 'jp' });
    expect(mockedGeocode).toHaveBeenNthCalledWith(2, 'Richmond Hotel Asakusa, Tokyo-to, Tokyo, Japan', { countryCode: 'jp' });
    const saved = (await listLodgings(userId, tripId)).find((item) => item.id === fallbackLodgingId)!;
    expect(saved).toEqual(expect.objectContaining({ lat: 35.714, lng: 139.794, coordinateSource: 'geocoder' }));
  });

  it('gives up cleanly when neither the address nor the name matches, and does not search by name after a provider error', async () => {
    const fresh = await insertLodging({ userId, tripId, status: 'Booked', name: 'Ghost Inn', checkInDate: '2027-03-02', checkOutDate: '2027-03-03', rooms: 1, totalCost: 1, costPerNight: 1, address: 'Nowhere Lane, Japan', paid_by: [], traveler_ids: [] });
    mockedGeocode.mockResolvedValue(null);
    expect((await locate({ kind: 'lodging', itemId: fresh.id }).expect(200)).body.status).toBe('not_found');
    expect(mockedGeocode).toHaveBeenCalledTimes(2);
    mockedGeocode.mockReset();
    mockedGeocode.mockRejectedValueOnce(new geocoder.GeocoderError('provider'));
    expect((await locate({ kind: 'lodging', itemId: fresh.id }).expect(200)).body.status).toBe('unavailable');
    expect(mockedGeocode).toHaveBeenCalledTimes(1);
  });

  it('locates each end of a car rental without losing the other', async () => {
    mockedGeocode.mockResolvedValueOnce({ lat: 35.77, lng: 140.39, geoCity: 'Narita', confidence: 0.9 });
    expect((await locate({ kind: 'car_rental', itemId: rentalId, which: 'pickup' }).expect(200)).body.status).toBe('located');
    mockedGeocode.mockResolvedValueOnce({ lat: 35.55, lng: 139.78, geoCity: 'Ota', confidence: 0.9 });
    expect((await locate({ kind: 'car_rental', itemId: rentalId, which: 'dropoff' }).expect(200)).body.status).toBe('located');
    const rental = (await listCarRentals(userId, tripId)).find((item) => item.id === rentalId)!;
    expect(rental).toEqual(expect.objectContaining({ lat: 35.77, lng: 140.39, dropoffLat: 35.55, dropoffLng: 139.78 }));
    mockedGeocode.mockClear();
    expect((await locate({ kind: 'car_rental', itemId: rentalId, which: 'pickup' }).expect(200)).body.status).toBe('already_located');
    expect(mockedGeocode).not.toHaveBeenCalled();
  });

  it('reports not found, quota and provider trouble as plain statuses, never as a pin', async () => {
    const fresh = await insertActivity({ userId, tripId, status: 'Proposed', activityType: 'Other', date: '2027-03-04', name: 'Mystery place', startLocation: 'zzzz', startTime: '', duration: '', cost: 0, bookedOn: '', reference: '', notes: '', paidBy: [], travelerIds: [] });
    mockedGeocode.mockResolvedValueOnce(null);
    expect((await locate({ kind: 'activity', itemId: fresh.id }).expect(200)).body.status).toBe('not_found');
    mockedGeocode.mockRejectedValueOnce(new geocoder.GeocoderError('quota'));
    expect((await locate({ kind: 'activity', itemId: fresh.id }).expect(200)).body.status).toBe('quota');
    mockedGeocode.mockRejectedValueOnce(new geocoder.GeocoderError('provider'));
    expect((await locate({ kind: 'activity', itemId: fresh.id }).expect(200)).body.status).toBe('unavailable');
    expect((await listActivities(userId, tripId)).find((item) => item.id === fresh.id)!.lat ?? null).toBeNull();
    expect((await locate({ kind: 'activity', itemId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });

  it('tells members the feature is available, and carries the credit on the day map', async () => {
    const capabilities = await request(app).get(`/api/trips/${tripId}/planning-capabilities`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(capabilities.body.locate).toBe(true);
    expect(capabilities.body.locateProvider).toBe('Geoapify');
    const points = await request(app).get(`/api/trips/${tripId}/planning-map-points?dayDate=2027-03-04`).set('Authorization', `Bearer ${token}`).expect(200);
    const lodging = points.body.points.find((point: any) => point.id === lodgingId);
    expect(lodging).toEqual(expect.objectContaining({ lat: 35.7148, lng: 139.7966, coordinateSource: 'geocoder', coordinateProvider: 'geoapify' }));
    expect(lodging.coordinateAttribution).toMatch(/Geoapify.*OpenStreetMap/);
    expect(lodging.coordinateCreditLinks).toEqual([{ label: 'Powered by Geoapify', url: 'https://www.geoapify.com/' }]);
  });
});
