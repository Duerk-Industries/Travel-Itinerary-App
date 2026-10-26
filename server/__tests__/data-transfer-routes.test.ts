import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import * as db from '../src/db';
import { registerAndLoginWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { dataTransferFingerprint } from '../src/utils/dataTransferFingerprint';

/** A checklist's entries with their checked state, read from whichever store the suite runs on. */
const checklistState = async (userId: string, itineraryId: string, detailId: string): Promise<Array<[string, boolean]>> => {
  if (db.getCurrentDbProvider() === 'firebase') {
    const details = await db.listItineraryDetails(userId, itineraryId);
    return (details.find((detail) => detail.id === detailId)?.checklistItems ?? []).map((item) => [item.label, Boolean(item.checkedAt)]);
  }
  // pg-mem cannot run the adapter's listing query (ANY(uuid[])), so read the rows directly.
  const { queryBlog } = require('../src/db.postgres');
  const stored = await queryBlog('SELECT label, checked_at as "checkedAt" FROM itinerary_checklist_items WHERE detail_id = $1 ORDER BY position', [detailId]);
  return stored.rows.map((item: { label: string; checkedAt: string | null }) => [item.label, Boolean(item.checkedAt)]);
};

describe('CSV import routes', () => {
  let token: string;
  let tripId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, rows: unknown[], importId = randomUUID()) =>
    request(app).post(path).set(auth()).send({ tripId, importId, rows });
  const row = (sourceRow: number, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ sourceRow, action: 'create', fields, ...extra });

  beforeAll(async () => {
    await db.initDb();
    ({ token } = await registerAndLoginWebUser({ email: `dt-${Date.now()}@example.com`, firstName: 'Data', lastName: 'Transfer', password: 'secret123' }));
    const groups = await request(app).get('/api/groups').set(auth()).expect(200);
    tripId = (await request(app).post('/api/trips').set(auth())
      .send({ name: 'Transfer trip', groupId: groups.body[0].id, startDate: '2027-05-01', endDate: '2027-05-10' }).expect(201)).body.id;
    await db.setFeatureFlag('activity_lodging_csv_import', true, null);
    for (const key of ['ground_transfer_csv_import', 'car_rental_csv_import', 'day_plan_csv_import']) await db.setFeatureFlag(key, false, null);
    clearFeatureFlagCacheForTesting();
  });
  afterAll(async () => { await db.closePool(); });

  describe('activities and lodging', () => {
    it('creates an activity with cost, status and booking details, and replays an identical request', async () => {
      const importId = randomUUID();
      const fields = { name: 'Sagrada Familia', date: '2027-05-03', startTime: '10:00', cost: 58, status: 'Needs Booking', reference: 'SF-1', bookedOn: 'Klook', notes: 'Early entry.' };
      const created = await post('/api/activities/import', [row(2, fields)], importId).expect(201);
      expect(created.body.records[0]).toMatchObject({ name: 'Sagrada Familia', cost: 58, status: 'Needs Booking', reference: 'SF-1', bookedOn: 'Klook', notes: 'Early entry.' });
      const replay = await post('/api/activities/import', [row(2, fields)], importId).expect(200);
      expect(replay.body).toEqual(created.body);
      await post('/api/activities/import', [row(2, { ...fields, name: 'Different' })], importId).expect(409);
    });

    it('an update writes only the fields it sends', async () => {
      const created = await post('/api/activities/import', [row(2, { name: 'Boqueria', date: '2027-05-03', cost: 12, status: 'Booked', notes: 'Original.' })]).expect(201);
      const record = created.body.records[0];
      const fingerprint = dataTransferFingerprint('activities', record);
      const updated = await post('/api/activities/import', [{ sourceRow: 2, action: 'update', existingId: record.id, expectedFingerprint: fingerprint, fields: { notes: 'Edited.' } }]).expect(201);
      expect(updated.body.records[0]).toMatchObject({ notes: 'Edited.', cost: 12, status: 'Booked', name: 'Boqueria' });
    });

    it('rejects an update whose record changed since review', async () => {
      const created = await post('/api/activities/import', [row(2, { name: 'Park Guell', date: '2027-05-04' })]).expect(201);
      const record = created.body.records[0];
      const stale = dataTransferFingerprint('activities', { ...record, notes: 'something else' });
      const rejected = await post('/api/activities/import', [{ sourceRow: 2, action: 'update', existingId: record.id, expectedFingerprint: stale, fields: { notes: 'x' } }]).expect(422);
      expect(rejected.body.rows[0].error).toMatch(/changed since review/i);
    });

    it('imports lodging notes, features and status, and updates one field without resetting the rest', async () => {
      const created = await post('/api/lodgings/import', [row(2, { name: 'Ryokan', checkInDate: '2027-05-02', checkOutDate: '2027-05-04', rooms: 2, totalCost: 400, costPerNight: 200, status: 'Booked', notes: 'Onsen.', features: ['Breakfast'] })]).expect(201);
      const record = created.body.records[0];
      expect(record).toMatchObject({ name: 'Ryokan', rooms: 2, status: 'Booked', notes: 'Onsen.', features: ['Breakfast'] });
      const updated = await post('/api/lodgings/import', [{ sourceRow: 2, action: 'update', existingId: record.id, expectedFingerprint: dataTransferFingerprint('lodgings', record), fields: { notes: 'Private onsen.' } }]).expect(201);
      expect(updated.body.records[0]).toMatchObject({ notes: 'Private onsen.', rooms: 2, status: 'Booked', features: ['Breakfast'] });
    });
  });

  describe('ground transfers', () => {
    const train = { transferType: 'Public Transit', departureDate: '2027-05-03', departureTime: '09:00', arrivalDate: '2027-05-03', arrivalTime: '11:15', departureLocation: 'Tokyo Station', arrivalLocation: 'Kyoto Station', carrier: 'JR', flightNumber: 'Nozomi 11', cost: 140, reference: 'ABC123', status: 'Booked' };

    it('is off until its own flag is enabled', async () => {
      await post('/api/transfers/import', [row(2, train)]).expect(404);
      await db.setFeatureFlag('ground_transfer_csv_import', true, null);
      clearFeatureFlagCacheForTesting();
    });

    it('creates a ground transfer and refuses to import a flight', async () => {
      const created = await post('/api/transfers/import', [row(2, train)]).expect(201);
      expect(created.body.records[0]).toMatchObject({ carrier: 'JR', cost: 140, bookingReference: 'ABC123', status: 'Booked' });
      expect(created.body.records[0]).toMatchObject({ departureLocation: 'Tokyo Station', arrivalLocation: 'Kyoto Station' });
      const flight = await post('/api/transfers/import', [row(2, { ...train, transferType: 'Flight' })]).expect(422);
      expect(flight.body.rows[0].error).toMatch(/flights are not imported/i);
    });

    it('validates times and ordering, and updates only the fields sent', async () => {
      const bad = await post('/api/transfers/import', [row(2, { ...train, departureTime: '9am', arrivalTime: '08:00' })]).expect(422);
      expect(bad.body.rows.map((entry: { error: string }) => entry.error).join(' ')).toMatch(/HH:mm/);
      const created = await post('/api/transfers/import', [row(2, { ...train, departureLocation: 'Osaka Station', arrivalLocation: 'Nara Station' })]).expect(201);
      const record = created.body.records[0];
      const updated = await post('/api/transfers/import', [{ sourceRow: 2, action: 'update', existingId: record.id, expectedFingerprint: dataTransferFingerprint('transfers', record), fields: { cost: 99 } }]).expect(201);
      expect(updated.body.records[0]).toMatchObject({ cost: 99, carrier: 'JR', status: 'Booked' });
    });

    it('will not update a flight through the transfers import', async () => {
      const flight = await db.insertFlight({
        userId: (await db.getTripById(tripId))!.createdBy as string, tripId, status: 'Booked', transferType: 'Flight', passengerName: 'P', passengerIds: [],
        departureDate: '2027-05-01', departureLocation: 'BOS', departureTime: '10:00', arrivalLocation: 'NRT', arrivalDate: '2027-05-02', arrivalTime: '12:00',
        cost: 0, carrier: '', flightNumber: '', bookingReference: '', paidBy: [],
      } as any);
      const rejected = await post('/api/transfers/import', [{ sourceRow: 2, action: 'update', existingId: flight.id, fields: { cost: 1 } }]).expect(422);
      expect(rejected.body.rows[0].error).toMatch(/flights cannot be changed/i);
    });
  });

  describe('car rentals', () => {
    it('is off until its flag is enabled, then creates a rental', async () => {
      const rental = { vendor: 'Hertz', model: 'Fiat 500', pickupDate: '2027-05-03', pickupLocation: 'Airport', dropoffDate: '2027-05-05', dropoffLocation: 'City', prepaid: 'No', cost: 95, reference: 'HZ-1', notes: 'Child seat.', status: 'Booked' };
      await post('/api/car-rentals/import', [row(2, rental)]).expect(404);
      await db.setFeatureFlag('car_rental_csv_import', true, null);
      clearFeatureFlagCacheForTesting();
      const created = await post('/api/car-rentals/import', [row(2, rental)]).expect(201);
      expect(created.body.records[0]).toMatchObject({ vendor: 'Hertz', model: 'Fiat 500', cost: 95, notes: 'Child seat.', status: 'Booked' });
      const backwards = await post('/api/car-rentals/import', [row(2, { ...rental, dropoffDate: '2027-05-01' })]).expect(422);
      expect(backwards.body.rows[0].error).toMatch(/before pick-up/i);
    });
  });

  describe('day-plan items', () => {
    it('is off until its flag is enabled, then creates notes, checklists and places', async () => {
      const items = [
        row(2, { kind: 'note', date: '2027-05-02', title: 'Booking priorities', body: '1. Shinkansen\nOTHER: ryokan fills early' }),
        row(3, { kind: 'checklist', date: '2027-05-02', title: 'Before dinner', checklist: [{ label: 'Reserve table', checked: true }, { label: 'Charge phone', checked: false }] }),
        row(4, { kind: 'place', date: '2027-05-02', title: 'Bar del Pla', time: '19:30', body: 'Tapas.', address: 'Carrer 1, Barcelona', lat: 41.4036, lng: 2.1744 }),
      ];
      await post('/api/itineraries/details/import', items).expect(404);
      await db.setFeatureFlag('day_plan_csv_import', true, null);
      clearFeatureFlagCacheForTesting();
      const created = await post('/api/itineraries/details/import', items).expect(201);
      const [note, checklist, place] = created.body.records;
      expect(note).toMatchObject({ kind: 'note', day: 2, noteBody: '1. Shinkansen\nOTHER: ryokan fills early' });
      expect(checklist.kind).toBe('checklist');
      expect(place).toMatchObject({ kind: 'place', time: '19:30', noteBody: 'Tapas.\nAddress: Carrer 1, Barcelona\nCoordinates: 41.4036, 2.1744' });
      const userId = (await db.getTripById(tripId))!.createdBy as string;
      expect(await checklistState(userId, checklist.itineraryId, checklist.id)).toEqual([['Reserve table', true], ['Charge phone', false]]);
    });

    it('rejects a bad kind, a date before the trip and an empty checklist', async () => {
      const rejected = await post('/api/itineraries/details/import', [
        row(2, { kind: 'poem', date: '2027-05-02', title: 'x' }),
        row(3, { kind: 'note', date: '2027-04-01', title: 'too early' }),
        row(4, { kind: 'checklist', date: '2027-05-02', title: 'empty', checklist: [] }),
      ]).expect(422);
      expect(rejected.body.rows.map((entry: { sourceRow: number }) => entry.sourceRow)).toEqual([2, 3, 4]);
    });

    it('updates a note\'s body and keeps its title', async () => {
      const created = await post('/api/itineraries/details/import', [row(2, { kind: 'note', date: '2027-05-06', title: 'To edit', body: 'Before.' })]).expect(201);
      const record = created.body.records[0];
      const fingerprint = dataTransferFingerprint('day-plan', record, { tripStart: '2027-05-01' });
      const updated = await post('/api/itineraries/details/import', [{ sourceRow: 2, action: 'update', existingId: record.id, expectedFingerprint: fingerprint, fields: { body: 'After.' } }]).expect(201);
      expect(updated.body.records[0]).toMatchObject({ activity: 'To edit', noteBody: 'After.', day: 6 });
    });
  });

  it('rejects an unknown field and a caller outside the trip', async () => {
    await post('/api/activities/import', [row(2, { name: 'x', mystery: 1 })]).expect(400);
    const other = await registerAndLoginWebUser({ email: `dt-other-${Date.now()}@example.com`, firstName: 'Other', lastName: 'User', password: 'secret123' });
    await request(app).post('/api/activities/import').set('Authorization', `Bearer ${other.token}`).send({ tripId, importId: randomUUID(), rows: [row(2, { name: 'x' })] }).expect(403);
  });
});
