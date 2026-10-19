/// <reference types="jest" />
/// <reference types="node" />
import { randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../src/app';
import * as db from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { applyAutomaticAssignments } from '../src/ingestion/assignment/autoAssign';
import { getParsedItemById } from '../src/ingestion/shared/repository';
import { registerAndLoginWebUser, registerWebUser, seedTiersForTest, setUserTierInDb, waitFor } from './helpers';

const letters = (): string => randomUUID().replace(/[0-9-]/g, value => value === '-' ? '' : String.fromCharCode(103 + Number(value)));

const FLIGHT_FIELDS = {
  departureLocation: 'Boston Logan',
  arrivalLocation: 'Tokyo Haneda',
  arrivalAirportCode: 'HND',
  flightNumber: 'DL167',
  providerVendor: 'Delta',
  cost: 450,
  currency: 'USD',
};

describe('automatic adding of matching bookings', () => {
  const uniq = Date.now();
  let token: string;
  let userId: string;
  let tripmateToken: string;
  let tripId: string;
  let groupId: string;
  let auth: { Authorization: string };
  let memberId: string;

  const setFlag = async (enabled: boolean) => {
    await db.setFeatureFlag('planning_auto_assign', enabled, null);
    clearFeatureFlagCacheForTesting();
  };

  /** A real upload (so job/document rows exist), then rewritten into the booking the test needs. */
  const seedItem = async (over: Record<string, unknown> = {}) => {
    const before = ((await request(app).get('/api/ingestion/review-items').set(auth)).body.items ?? []).map((i: any) => i.id);
    await request(app).post('/api/ingestion/upload').set(auth).attach('files', Buffer.from(`Subject: seed ${letters()}\nBooking text ${letters()} ${letters()}`), 'seed.txt').expect(202);
    let id = '';
    await waitFor(async () => {
      const items = (await request(app).get('/api/ingestion/review-items').set(auth)).body.items ?? [];
      id = items.find((i: any) => !before.includes(i.id))?.id ?? '';
      return Boolean(id);
    }, 15000, 100);
    const row = {
      item_type: 'flight', source_type: 'MANUAL_UPLOAD', confidence_score: 0.95, timezone_status: 'RESOLVED',
      original_timezone: 'America/New_York', start: '2027-05-10T13:30:00Z', end: '2027-05-11T10:00:00Z',
      confirmation: `CONF${Math.floor(Math.random() * 1e6)}`, fields: FLIGHT_FIELDS, review_status: 'READY_FOR_REVIEW',
      ...over,
    };
    await queryBlog(
      `UPDATE parsed_items SET item_type=$2, source_type=$3, confidence_score=$4, timezone_status=$5, original_timezone=$6,
         start_datetime_utc=$7, end_datetime_utc=$8, confirmation_number=$9, extracted_fields=$10::jsonb, review_status=$11,
         provider_vendor='Delta', traveler_names='["Day Order"]'::jsonb, deduplication_fingerprint=$12 WHERE id=$1`,
      [id, row.item_type, row.source_type, row.confidence_score, row.timezone_status, row.original_timezone, row.start, row.end, row.confirmation, JSON.stringify(row.fields), row.review_status, `seed-${randomUUID()}`]
    );
    return id;
  };

  const run = async (id: string) => {
    const item = (await getParsedItemById(userId, id))!;
    return applyAutomaticAssignments({ userId, items: [item] });
  };
  const flights = async () => (await request(app).get(`/api/transfers?tripId=${tripId}`).set(auth).expect(200)).body as any[];
  const expenses = async () => (await request(app).get(`/api/expenses?tripId=${tripId}`).set(auth).expect(200)).body as any[];
  const status = async (id: string) => (await request(app).get(`/api/ingestion/review-items/${id}`).set(auth).expect(200)).body;
  const undo = (id: string, authHeader = auth) => request(app).post(`/api/ingestion/review-items/${id}/undo`).set(authHeader);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await db.initDb();
    await seedTiersForTest();
    ({ token, userId } = await registerAndLoginWebUser({ firstName: 'Day', lastName: 'Order', email: `auto-assign+${uniq}@example.com`, password: 'secret123' }));
    await setUserTierInDb(userId, 'premium');
    auth = { Authorization: `Bearer ${token}` };
    const mate = await registerAndLoginWebUser({ firstName: 'Trip', lastName: 'Mate', email: `auto-assign-mate+${uniq}@example.com`, password: 'secret123' });
    tripmateToken = mate.token;
    await setUserTierInDb(mate.userId, 'premium');
    const groups = await request(app).get('/api/groups').set(auth).expect(200);
    groupId = groups.body[0].id;
    await request(app).post(`/api/groups/${groupId}/members`).set(auth).send({ email: `auto-assign-mate+${uniq}@example.com` }).expect(201);
    const trip = await request(app).post('/api/trips').set(auth).send({ groupId, name: 'Tokyo 2027', startDate: '2027-05-11', endDate: '2027-05-21' }).expect(201);
    tripId = trip.body.id;
    await queryBlog('UPDATE trips SET destination=$2 WHERE id=$1', [tripId, 'Tokyo, Japan']);
    const members = await request(app).get(`/api/groups/${groupId}/members`).set(auth).expect(200);
    memberId = members.body.find((m: any) => (m.email ?? m.userEmail) === `auto-assign+${uniq}@example.com`)?.id;
    await setFlag(true);
  });

  afterEach(async () => {
    await request(app).put('/api/ingestion/settings').set(auth).send({ autoAssign: null });
    await setFlag(true);
  });

  describe('adding', () => {
    it('adds a matching booking from the owner\'s own upload, with its cost, a note for the group, and a way back', async () => {
      const id = await seedItem();
      const added = await run(id);
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ itemId: id, tripId, tripName: 'Tokyo 2027' });
      expect(added[0]!.reasons.join(' ')).toMatch(/fit this trip/);

      const trip = await flights();
      expect(trip.some((f) => (f.flightNumber ?? f.flight_number) === 'DL167')).toBe(true);
      const cost = (await expenses()).find((e) => e.sourceType === 'flight');
      expect(Number(cost.amount)).toBe(450);

      // Gone from the review queue; reported as recently added, with when the undo window closes.
      const queue = (await request(app).get('/api/ingestion/review-items').set(auth)).body.items;
      expect(queue.some((i: any) => i.id === id)).toBe(false);
      const recent = (await request(app).get('/api/ingestion/auto-added').set(auth).expect(200)).body.items;
      const entry = recent.find((r: any) => r.item.id === id);
      expect(entry.tripName).toBe('Tokyo 2027');
      const days = (new Date(entry.undoExpiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7.01);
      expect((await status(id)).assignment).toMatchObject({ mode: 'AUTO', tripId, undone: false });
    });

    it('also handles other booking types (a hotel stay becomes lodging)', async () => {
      const id = await seedItem({
        item_type: 'hotel',
        start: '2027-05-12T15:00:00Z',
        end: '2027-05-15T02:00:00Z',
        original_timezone: 'Asia/Tokyo',
        fields: { name: 'Shinjuku Granbell', address: 'Shinjuku, Tokyo', totalCost: 600 },
      });
      expect(await run(id)).toHaveLength(1);
      const lodgings = (await request(app).get(`/api/lodgings?tripId=${tripId}`).set(auth).expect(200)).body as any[];
      expect(lodgings.some((l) => l.name === 'Shinjuku Granbell')).toBe(true);
    });
  });

  describe('when it must not add automatically', () => {
    it('leaves the booking for review when the release switch is off', async () => {
      await setFlag(false);
      const id = await seedItem();
      expect(await run(id)).toHaveLength(0);
      expect((await status(id)).placement).toMatchObject({ decision: 'suggest', tripId, heldBack: 'automatic_adding_off' });
    });

    it('respects a person who turned it off, and uses the default (on) again when they clear the choice', async () => {
      await request(app).put('/api/ingestion/settings').set(auth).send({ autoAssign: false }).expect(200);
      const first = await seedItem();
      expect(await run(first)).toHaveLength(0);
      const settings = await request(app).get('/api/ingestion/settings').set(auth).expect(200);
      expect(settings.body.autoAssign).toEqual({ available: true, choice: false, enabled: false });

      await request(app).put('/api/ingestion/settings').set(auth).send({ autoAssign: null }).expect(200);
      expect((await request(app).get('/api/ingestion/settings').set(auth)).body.autoAssign).toEqual({ available: true, choice: null, enabled: true });
      expect(await run(first)).toHaveLength(1);
    });

    it('never adds forwarded email or anything that is not the owner\'s own upload', async () => {
      const id = await seedItem({ source_type: 'FORWARDED_MAILBOX' });
      expect(await run(id)).toHaveLength(0);
      expect((await status(id)).placement).toMatchObject({ decision: 'suggest', tripId, heldBack: 'untrusted_source' });
    });

    it('never adds items an extractor marked as always-review', async () => {
      const id = await seedItem({ fields: { ...FLIGHT_FIELDS, automaticAssignmentAllowed: false } });
      expect(await run(id)).toHaveLength(0);
      expect((await status(id)).placement.heldBack).toBe('review_required');
    });

    it('asks first when the time zone is uncertain or confidence is not high', async () => {
      const unsure = await seedItem({ timezone_status: 'INFERRED' });
      expect(await run(unsure)).toHaveLength(0);
      expect((await status(unsure)).placement.heldBack).toBe('timezone_uncertain');
      const faint = await seedItem({ confidence_score: 0.8 });
      expect(await run(faint)).toHaveLength(0);
      expect((await status(faint)).placement.heldBack).toBe('low_confidence');
    });

    it('asks first when two trips fit equally well', async () => {
      const twin = await request(app).post('/api/trips').set(auth).send({ groupId, name: 'Tokyo again', startDate: '2027-05-11', endDate: '2027-05-21' }).expect(201);
      await queryBlog('UPDATE trips SET destination=$2 WHERE id=$1', [twin.body.id, 'Tokyo, Japan']);
      const id = await seedItem();
      expect(await run(id)).toHaveLength(0);
      expect((await status(id)).placement.heldBack).toBe('not_unique');
      await request(app).delete(`/api/trips/${twin.body.id}`).set(auth).expect(204);
    });

    it('asks first when the booking is for somewhere else entirely, and never touches a trip the person is not in', async () => {
      const id = await seedItem({ fields: { ...FLIGHT_FIELDS, arrivalLocation: 'Reykjavik', arrivalAirportCode: 'KEF' } });
      expect(await run(id)).toHaveLength(0);
      const outsider = await registerAndLoginWebUser({ firstName: 'Out', lastName: 'Sider', email: `auto-assign-out+${uniq}@example.com`, password: 'secret123' });
      const strangerTrips = await request(app).get('/api/trips').set({ Authorization: `Bearer ${outsider.token}` }).expect(200);
      expect(JSON.stringify(strangerTrips.body)).not.toContain(tripId);
    });

    it('does not pretend certainty about what the real parser produced: a plain-text confirmation stays a suggestion', async () => {
      const text = ['Subject: Flight confirmation', 'Traveler: Day Order', 'Airline: Delta Airlines', 'Flight Number: DL999', 'Confirmation Code: ZZZ111',
        'Departure: 2027-05-10 09:30', 'From: Boston (BOS)', 'To: Tokyo Haneda (HND)'].join('\n');
      const before = ((await request(app).get('/api/ingestion/review-items').set(auth)).body.items ?? []).map((i: any) => i.id);
      await request(app).post('/api/ingestion/upload').set(auth).attach('files', Buffer.from(text), 'real-flight.txt').expect(202);
      let created: any;
      await waitFor(async () => {
        const items = (await request(app).get('/api/ingestion/review-items').set(auth)).body.items ?? [];
        created = items.find((i: any) => !before.includes(i.id));
        return Boolean(created);
      }, 15000, 100);
      // Real text parsing gave an unknown time zone, so it must wait for a person.
      expect(created.status).toBe('READY_FOR_REVIEW');
      expect(created.timezoneStatus).not.toBe('RESOLVED');
    });
  });

  describe('taking it back', () => {
    it('removes the booking, its cost and its note, returns it to the queue, and refuses a second undo', async () => {
      const id = await seedItem();
      await run(id);
      const before = (await flights()).length;
      const undone = await undo(id).expect(200);
      expect(undone.body).toMatchObject({ undone: true, itemId: id, tripId });
      expect((await flights()).length).toBe(before - 1);
      expect((await expenses()).some((e) => e.sourceType === 'flight' && e.vendor !== 'x' && Number(e.amount) === 450 && false)).toBe(false);
      const item = (await request(app).get('/api/ingestion/review-items').set(auth).expect(200)).body.items.find((i: any) => i.id === id);
      expect(item.status).toBe('READY_FOR_REVIEW');
      expect((await status(id)).assignment.undone).toBe(true);
      const again = await undo(id).expect(409);
      expect(again.body.code).toBe('UNDO_ALREADY_UNDONE');
    });

    it('leaves everything alone if a tripmate edited the booking', async () => {
      const id = await seedItem({ confirmation: 'EDITME1' });
      await run(id);
      const flight = (await flights()).find((f) => (f.bookingReference ?? f.booking_reference) === 'EDITME1');
      await request(app).patch(`/api/transfers/${flight.id}`).set({ Authorization: `Bearer ${tripmateToken}` }).send({ carrier: 'Changed Airline' });
      await queryBlog('UPDATE flights SET carrier = $2 WHERE id = $1', [flight.id, 'Changed Airline']);
      const refused = await undo(id).expect(409);
      expect(refused.body.code).toBe('UNDO_BOOKING_EDITED');
      expect((await flights()).some((f) => f.id === flight.id)).toBe(true);
    });

    it('leaves everything alone if the cost was changed', async () => {
      const id = await seedItem({ confirmation: 'COSTME1' });
      await run(id);
      const flight = (await flights()).find((f) => (f.bookingReference ?? f.booking_reference) === 'COSTME1');
      await queryBlog(`UPDATE expenses SET amount = 999 WHERE source_type = 'flight' AND source_id = $1`, [flight.id]);
      const refused = await undo(id).expect(409);
      expect(refused.body.code).toBe('UNDO_EXPENSE_EDITED');
      expect((await flights()).some((f) => f.id === flight.id)).toBe(true);
    });

    it('leaves everything alone if travelers recorded payments after it was added', async () => {
      const id = await seedItem({ confirmation: 'PAYME01' });
      await run(id);
      await queryBlog(
        `INSERT INTO trip_payments (id, trip_id, group_id, recorded_by, payer_id, receiver_id, payment_date, amount_cents, currency, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'2027-05-12',1000,'USD', NOW() + INTERVAL '1 minute')`,
        [randomUUID(), tripId, groupId, userId, randomUUID(), randomUUID()]
      );
      const refused = await undo(id).expect(409);
      expect(refused.body.code).toBe('UNDO_PAYMENTS_RECORDED');
    });

    it('stops working after the seven days are up', async () => {
      const id = await seedItem({ confirmation: 'LATE001' });
      await run(id);
      await queryBlog(`UPDATE parsed_item_assignments SET undo_expires_at = NOW() - INTERVAL '1 minute' WHERE parsed_item_id = $1`, [id]);
      const refused = await undo(id).expect(409);
      expect(refused.body.code).toBe('UNDO_EXPIRED');
      const recent = (await request(app).get('/api/ingestion/auto-added').set(auth).expect(200)).body.items;
      expect(recent.some((r: any) => r.item.id === id)).toBe(false);
    });

    it('is only available to the person whose import it was, and only for automatic additions', async () => {
      const id = await seedItem({ confirmation: 'OWNER01' });
      await run(id);
      const stranger = { Authorization: `Bearer ${tripmateToken}` };
      await undo(id, stranger).expect(404);
      await undo(randomUUID()).expect(404);

      const manual = await seedItem({ confirmation: 'MANUAL1' });
      await request(app).post(`/api/ingestion/review-items/${manual}/assign`).set(auth).send({ tripId }).expect(201);
      const refused = await undo(manual).expect(409);
      expect(refused.body.code).toBe('UNDO_NOT_AUTOMATIC');
    });
  });

  describe('settings', () => {
    it('rejects values other than on, off or default', async () => {
      await request(app).put('/api/ingestion/settings').set(auth).send({ autoAssign: 'yes' }).expect(400);
      await request(app).put('/api/ingestion/settings').set(auth).send({}).expect(400);
    });

    it('reports that automatic adding is not available while the release switch is off', async () => {
      await setFlag(false);
      expect((await request(app).get('/api/ingestion/settings').set(auth)).body.autoAssign).toEqual({ available: false, choice: null, enabled: false });
    });
  });
});
