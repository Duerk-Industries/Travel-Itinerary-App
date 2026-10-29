import request from 'supertest';
import { app } from '../src/app';
import * as db from '../src/db';
import { registerAndLoginWebUser } from './helpers';
import { randomUUID } from 'crypto';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

describe('optional activities', () => {
  let token: string;
  let tripId: string;
  let hotelId: string;
  let otherHotelId: string;
  beforeAll(async () => {
    await db.initDb();
    ({ token } = await registerAndLoginWebUser({ email: `optional-${Date.now()}@example.com`, firstName: 'Optional', lastName: 'Traveler', password: 'secret123' }));
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    const createTrip = async (name: string) => (await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`)
      .send({ name, groupId: groups.body[0].id, startDate: '2027-05-01', endDate: '2027-05-10' }).expect(201)).body.id as string;
    tripId = await createTrip('Optional trip');
    const otherTripId = await createTrip('Other trip');
    const createHotel = async (id: string) => (await request(app).post('/api/lodgings').set('Authorization', `Bearer ${token}`)
      .send({ tripId: id, name: 'Base hotel', status: 'Proposed', checkInDate: '2027-05-04', checkOutDate: '2027-05-06' }).expect(201)).body.id as string;
    hotelId = await createHotel(tripId);
    otherHotelId = await createHotel(otherTripId);
    await db.setFeatureFlag('activity_lodging_csv_import', true, null);
    clearFeatureFlagCacheForTesting();
  });
  afterAll(async () => { await db.closePool(); });

  it('saves an undated activity near a hotel, schedules it, and makes it optional again', async () => {
    const created = await request(app).post('/api/activities').set('Authorization', `Bearer ${token}`)
      .send({ tripId, name: 'Museum option', status: 'Booked', nearLodgingId: hotelId, cost: 25 }).expect(201);
    expect(created.body).toMatchObject({ date: '', nearLodgingId: hotelId });
    const id = created.body.id as string;
    const renamed = await request(app).patch(`/api/activities/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed museum' }).expect(200);
    expect(renamed.body).toMatchObject({ date: '', nearLodgingId: hotelId });
    const scheduled = await request(app).patch(`/api/activities/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ date: '2027-05-04' }).expect(200);
    expect(scheduled.body).toMatchObject({ date: '2027-05-04', nearLodgingId: hotelId });
    const undated = await request(app).put(`/api/activities/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ date: null, nearLodgingId: null }).expect(200);
    expect(undated.body).toMatchObject({ date: '', nearLodgingId: null });
    const list = await request(app).get(`/api/activities?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.filter((row: { id: string }) => row.id === id)).toHaveLength(1);
    expect(list.body.find((row: { id: string }) => row.id === id)).toMatchObject({ date: '', nearLodgingId: null });
  });

  it('rejects a nearby hotel from a different trip on create and update', async () => {
    await request(app).post('/api/activities').set('Authorization', `Bearer ${token}`)
      .send({ tripId, name: 'Invalid hotel', nearLodgingId: otherHotelId }).expect(400);
    const created = await request(app).post('/api/activities').set('Authorization', `Bearer ${token}`)
      .send({ tripId, name: 'Any day', status: 'Proposed', date: '' }).expect(201);
    await request(app).patch(`/api/activities/${created.body.id}`).set('Authorization', `Bearer ${token}`)
      .send({ nearLodgingId: otherHotelId }).expect(400);
    await request(app).patch(`/api/activities/${created.body.id}`).set('Authorization', `Bearer ${token}`)
      .send({ nearLodgingId: 'not-a-hotel-id' }).expect(400);
  });

  it('imports an activity with no date as optional', async () => {
    const imported = await request(app).post('/api/activities/import').set('Authorization', `Bearer ${token}`)
      .send({ tripId, importId: randomUUID(), rows: [{ sourceRow: 2, action: 'create', fields: { name: 'Imported option', date: '', cost: 0 } }] }).expect(201);
    expect(imported.body.records[0]).toMatchObject({ name: 'Imported option', date: '' });
  });

  it('clears the hotel restriction when that hotel is deleted', async () => {
    const created = await request(app).post('/api/activities').set('Authorization', `Bearer ${token}`)
      .send({ tripId, name: 'Hotel option', status: 'Proposed', nearLodgingId: hotelId }).expect(201);
    await request(app).delete(`/api/lodgings/${hotelId}`).set('Authorization', `Bearer ${token}`).expect(204);
    expect(await db.getActivityById(created.body.id)).toMatchObject({ date: '', nearLodgingId: null });
  });
});
