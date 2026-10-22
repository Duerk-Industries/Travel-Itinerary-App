/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser, registerWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

describe('POST /api/expenses with Idempotency-Key (offline replay)', () => {
  const uniq = Date.now();
  const owner = { email: `expense-idem-a+${uniq}@example.com`, firstName: 'Idem', lastName: 'Owner', password: 'testtest' };
  const other = { email: `expense-idem-b+${uniq}@example.com`, firstName: 'Idem', lastName: 'Other', password: 'testtest' };
  let token: string;
  let otherToken: string;
  let groupId: string;
  let tripId: string;
  let memberId: string;

  const body = (overrides: Record<string, unknown> = {}) => ({
    tripId,
    expenseDate: '2026-11-12',
    category: 'Dinner',
    amount: 42.5,
    currency: 'USD',
    payerIds: [memberId],
    forIds: [memberId],
    vendor: 'Ramen Shop',
    ...overrides,
  });

  const post = (key: string | null, payload: Record<string, unknown>, authToken = token) => {
    const req = request(app).post('/api/expenses').set('Authorization', `Bearer ${authToken}`);
    if (key !== null) req.set('Idempotency-Key', key);
    return req.send(payload);
  };

  const listExpenses = async () =>
    (await request(app).get(`/api/expenses?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200)).body as any[];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    const login = await registerAndLoginWebUser(owner);
    token = login.token;
    await setUserTierInDb(login.userId, 'premium');
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    groupId = groups.body[0]?.id as string;
    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Idempotency Trip ${uniq}`, groupId })
      .expect(201);
    tripId = trip.body.id as string;
    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token}`).expect(200);
    memberId = members.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;

    const otherLogin = await registerAndLoginWebUser(other);
    otherToken = otherLogin.token;
    await setUserTierInDb(otherLogin.userId, 'premium');
  });

  afterAll(async () => {
    await closePool();
  });

  it('creates once and replays the original expense for the same key and payload', async () => {
    const key = `op-${uniq}-replay`;
    const first = await post(key, body()).expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const second = await post(key, body()).expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);

    const matching = (await listExpenses()).filter((e) => e.vendor === 'Ramen Shop');
    expect(matching).toHaveLength(1);
  });

  it('treats a retry whose id lists are in a different order as the same request', async () => {
    const key = `op-${uniq}-order`;
    const payload = body({ vendor: 'Order Test' });
    const first = await post(key, payload).expect(201);
    const replay = await post(key, { ...payload, forIds: [...(payload.forIds as string[])].reverse() }).expect(201);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('rejects the same key with a different payload as 409 and does not create a second expense', async () => {
    const key = `op-${uniq}-conflict`;
    await post(key, body({ vendor: 'Conflict A' })).expect(201);
    const conflict = await post(key, body({ vendor: 'Conflict A', amount: 99 })).expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await listExpenses()).filter((e) => e.vendor === 'Conflict A')).toHaveLength(1);
  });

  it('collapses concurrent retries of one operation into a single expense', async () => {
    const key = `op-${uniq}-race`;
    const results = await Promise.all([1, 2, 3].map(() => post(key, body({ vendor: 'Race' }))));
    results.forEach((r) => expect(r.status).toBe(201));
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect((await listExpenses()).filter((e) => e.vendor === 'Race')).toHaveLength(1);
  });

  it('scopes keys to the authenticated user: another user reusing a key cannot read or replay it', async () => {
    const key = `op-${uniq}-owner`;
    const mine = await post(key, body({ vendor: 'Mine' })).expect(201);
    // The other user is not in this trip, so they are refused before any replay lookup happens.
    await post(key, body({ vendor: 'Mine' }), otherToken).expect(403);
    const again = await post(key, body({ vendor: 'Mine' })).expect(201);
    expect(again.body.id).toBe(mine.body.id);
  });

  it('rejects a malformed Idempotency-Key', async () => {
    const res = await post('short', body()).expect(400);
    expect(res.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('still creates a new expense per request when no Idempotency-Key is sent', async () => {
    const payload = body({ vendor: 'No Key' });
    await post(null, payload).expect(201);
    await post(null, payload).expect(201);
    expect((await listExpenses()).filter((e) => e.vendor === 'No Key')).toHaveLength(2);
  });
});
