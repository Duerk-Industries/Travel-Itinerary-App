/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import * as db from '../src/db';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { orderDayActivities } from '../src/utils/dayOrder';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';

describe('PUT /api/activities/day-order', () => {
  const uniq = Date.now();
  let token: string;
  let outsiderToken: string;
  let tripId: string;
  let otherTripId: string;
  const DAY = '2027-05-02';
  const OTHER_DAY = '2027-05-03';

  const create = async (name: string, startTime: string, date = DAY, trip = () => tripId) =>
    (
      await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${token}`)
        .send({ tripId: trip(), date, name, startLocation: `${name} St`, startTime, duration: '1h', cost: '0' })
        .expect(201)
    ).body.id as string;

  const reorder = (body: Record<string, unknown>, authToken = token) =>
    request(app).put('/api/activities/day-order').set('Authorization', `Bearer ${authToken}`).send(body);

  const listDay = async (date: string) =>
    ((await request(app).get(`/api/activities?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200)).body as any[])
      .filter((a) => a.date === date);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await db.initDb();
    await seedTiersForTest();
    ({ token } = await registerAndLoginWebUser({ firstName: 'Day', lastName: 'Order', email: `day-order+${uniq}@example.com`, password: 'secret123' }));
    ({ token: outsiderToken } = await registerAndLoginWebUser({ firstName: 'Out', lastName: 'Sider', email: `day-order-out+${uniq}@example.com`, password: 'secret123' }));
    const group = await request(app).post('/api/groups').set('Authorization', `Bearer ${token}`).send({ name: `Order group ${uniq}` }).expect(201);
    const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`).send({ groupId: group.body.id, name: 'Order trip', startDate: '2027-05-01', endDate: '2027-05-05' }).expect(201);
    tripId = trip.body.id;
    const other = await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`).send({ groupId: group.body.id, name: 'Other trip', startDate: '2027-05-01', endDate: '2027-05-05' }).expect(201);
    otherTripId = other.body.id;
    await db.setFeatureFlag('planning_day_order', true, null);
    clearFeatureFlagCacheForTesting();
  });

  it('stores the new order, which then wins over start time everywhere activities are listed', async () => {
    const a = await create('Alpha', '09:00');
    const b = await create('Bravo', '10:00');
    const c = await create('Charlie', '11:00');
    const res = await reorder({ tripId, date: DAY, expectedIds: [a, b, c], orderedIds: [c, a, b] }).expect(200);
    expect(res.body.order).toEqual([c, a, b]);

    const stored = await listDay(DAY);
    const byId = new Map(stored.map((x) => [x.id, x.dayPosition]));
    expect([byId.get(c), byId.get(a), byId.get(b)]).toEqual([0, 1, 2]);
  });

  it('rejects a stale expected order with 409 and the current order, writing nothing', async () => {
    const x = await create('X-ray', '09:00', OTHER_DAY);
    const y = await create('Yankee', '10:00', OTHER_DAY);
    await reorder({ tripId, date: OTHER_DAY, expectedIds: [x, y], orderedIds: [y, x] }).expect(200);

    // A second client still thinks the day is [x, y].
    const stale = await reorder({ tripId, date: OTHER_DAY, expectedIds: [x, y], orderedIds: [x, y] }).expect(409);
    expect(stale.body.code).toBe('DAY_ORDER_STALE');
    expect(stale.body.currentOrder).toEqual([y, x]);
    const after = await listDay(OTHER_DAY);
    expect(after.find((r) => r.id === y)?.dayPosition).toBe(0);
  });

  it('rejects an order that adds, drops or repeats an activity', async () => {
    const day = '2027-05-04';
    const p = await create('Papa', '09:00', day);
    const q = await create('Quebec', '10:00', day);
    const dropped = await reorder({ tripId, date: day, expectedIds: [p, q], orderedIds: [p] }).expect(409);
    expect(dropped.body.code).toBe('DAY_ORDER_MISMATCH');
    await reorder({ tripId, date: day, expectedIds: [p, q], orderedIds: [p, p] }).expect(409);
    await reorder({ tripId, date: day, expectedIds: [p, q], orderedIds: [p, '00000000-0000-0000-0000-000000000000'] }).expect(409);
    const unchanged = await listDay(day);
    expect(unchanged.every((r) => r.dayPosition == null)).toBe(true);
  });

  it('only touches the requested day and the requested trip', async () => {
    const day = '2027-05-05';
    const m = await create('Mike', '09:00', day);
    const n = await create('November', '10:00', day);
    const otherDayId = await create('Oscar', '09:00', '2027-05-01');
    const otherTripActivity = await create('Papa-other-trip', '09:00', day, () => otherTripId);
    await reorder({ tripId, date: day, expectedIds: [m, n], orderedIds: [n, m] }).expect(200);

    expect((await listDay('2027-05-01')).find((r) => r.id === otherDayId)?.dayPosition ?? null).toBeNull();
    const otherTrip = ((await request(app).get(`/api/activities?tripId=${otherTripId}`).set('Authorization', `Bearer ${token}`).expect(200)).body as any[]);
    expect(otherTrip.find((r) => r.id === otherTripActivity)?.dayPosition ?? null).toBeNull();
  });

  it('clears a stop\'s position when it is moved to a different day', async () => {
    const day = '2027-05-02';
    const moving = await create('Zulu', '08:00', day);
    const anchor = await create('Zebra', '08:30', day);
    const current = orderDayActivities(await listDay(day)).map((r) => r.id);
    await reorder({ tripId, date: day, expectedIds: current, orderedIds: [...current] }).expect(200);
    await request(app).put(`/api/activities/${moving}`).set('Authorization', `Bearer ${token}`).send({ date: '2027-05-04' }).expect(200);
    const moved = (await listDay('2027-05-04')).find((r) => r.id === moving);
    expect(moved?.dayPosition ?? null).toBeNull();
    expect((await listDay(day)).some((r) => r.id === anchor)).toBe(true);
  });

  it('refuses people outside the trip', async () => {
    const day = '2027-05-02';
    const ids = (await listDay(day)).map((r) => r.id);
    await reorder({ tripId, date: day, expectedIds: ids, orderedIds: [...ids].reverse() }, outsiderToken).expect(403);
  });

  it('validates the request shape', async () => {
    await reorder({ tripId: 'not-a-uuid', date: DAY, expectedIds: [], orderedIds: [] }).expect(400);
    await reorder({ tripId, date: 'May 2', expectedIds: [], orderedIds: [] }).expect(400);
    await reorder({ tripId, date: DAY }).expect(400);
  });

  it('is unavailable while the rollout flag is off, and is reported by planning-capabilities', async () => {
    let caps = await request(app).get(`/api/trips/${tripId}/planning-capabilities`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(caps.body.dayOrder).toBe(true);

    await db.setFeatureFlag('planning_day_order', false, null);
    clearFeatureFlagCacheForTesting();
    const off = await reorder({ tripId, date: DAY, expectedIds: [], orderedIds: [] }).expect(404);
    expect(off.body.code).toBe('FEATURE_DISABLED');
    caps = await request(app).get(`/api/trips/${tripId}/planning-capabilities`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(caps.body.dayOrder).toBe(false);

    await db.setFeatureFlag('planning_day_order', true, null);
    clearFeatureFlagCacheForTesting();
  });
});
