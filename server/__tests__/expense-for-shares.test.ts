/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { normalizeForShares } from '../src/routes/expenseDtos';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

describe('normalizeForShares', () => {
  it('keeps positive weights for travelers the expense is for, filling the rest with 1', () => {
    expect(normalizeForShares({ a: 2, b: 1 }, ['a', 'b', 'c'])).toEqual({ a: 2, b: 1, c: 1 });
  });

  it('treats missing, empty, all-equal, invalid or out-of-range weights as an equal split', () => {
    expect(normalizeForShares(undefined, ['a', 'b'])).toBeNull();
    expect(normalizeForShares({}, ['a', 'b'])).toBeNull();
    expect(normalizeForShares({ a: 3, b: 3 }, ['a', 'b'])).toBeNull();
    expect(normalizeForShares({ a: -1, b: 'x', c: 0 }, ['a', 'b', 'c'])).toBeNull();
    expect(normalizeForShares({ a: 1000 }, ['a', 'b'])).toBeNull();
    expect(normalizeForShares([2, 1], ['a', 'b'])).toBeNull();
  });

  it('drops weights for people the expense is not for', () => {
    expect(normalizeForShares({ a: 2, z: 5 }, ['a', 'b'])).toEqual({ a: 2, b: 1 });
  });
});

describe('expense for-shares (uneven split)', () => {
  const uniq = Date.now();
  const owner = { email: `shares-a+${uniq}@example.com`, firstName: 'Shares', lastName: 'Owner', password: 'testtest' };
  let token: string;
  let tripId: string;
  let me: string;
  let guest: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const body = (overrides: Record<string, unknown> = {}) => ({
    tripId, expenseDate: '2026-11-12', category: 'Dinner', amount: 60, currency: 'USD', payerIds: [me], forIds: [me, guest], vendor: 'Tapas', ...overrides,
  });
  const list = async () => (await request(app).get(`/api/expenses?tripId=${tripId}`).set(auth()).expect(200)).body as any[];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    const login = await registerAndLoginWebUser(owner);
    token = login.token;
    await setUserTierInDb(login.userId, 'premium');
    const groupId = (await request(app).get('/api/groups').set(auth()).expect(200)).body[0]?.id as string;
    tripId = (await request(app).post('/api/trips').set(auth()).send({ name: `Shares Trip ${uniq}`, groupId }).expect(201)).body.id;
    me = (await request(app).get(`/api/groups/${groupId}/members`).set(auth()).expect(200)).body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;
    const added = await request(app).post(`/api/account/trips/${tripId}/members`).set(auth()).send({ guestName: 'Guest Gus', firstName: 'Guest', lastName: 'Gus' });
    expect(added.status).toBeLessThan(300);
    const members = (await request(app).get(`/api/groups/${groupId}/members`).set(auth()).expect(200)).body as any[];
    guest = members.find((m) => m.id !== me)?.id;
    expect(guest).toBeTruthy();
  });

  afterAll(async () => {
    await closePool();
  });

  it('stores and returns weights, and an equal split has none', async () => {
    const uneven = await request(app).post('/api/expenses').set(auth()).send(body({ forShares: { [me]: 2, [guest]: 1 } })).expect(201);
    expect(uneven.body.forShares).toEqual({ [me]: 2, [guest]: 1 });
    const equal = await request(app).post('/api/expenses').set(auth()).send(body({ vendor: 'Equal', forShares: { [me]: 1, [guest]: 1 } })).expect(201);
    expect(equal.body.forShares ?? null).toBeNull();
    const rows = await list();
    expect(rows.find((e) => e.id === uneven.body.id)?.forShares).toEqual({ [me]: 2, [guest]: 1 });
    expect(rows.find((e) => e.id === equal.body.id)?.forShares ?? null).toBeNull();
  });

  it('changes and clears weights on edit', async () => {
    const created = await request(app).post('/api/expenses').set(auth()).send(body({ vendor: 'Editable', forShares: { [me]: 3, [guest]: 1 } })).expect(201);
    const changed = await request(app).put(`/api/expenses/${created.body.id}`).set(auth()).send(body({ vendor: 'Editable', forShares: { [me]: 1, [guest]: 2 } })).expect(200);
    expect(changed.body.forShares).toEqual({ [me]: 1, [guest]: 2 });
    const cleared = await request(app).put(`/api/expenses/${created.body.id}`).set(auth()).send(body({ vendor: 'Editable' })).expect(200);
    expect(cleared.body.forShares ?? null).toBeNull();
  });

  it('treats a retry with different weights under the same key as a different request', async () => {
    const key = `shares-${uniq}-key`;
    await request(app).post('/api/expenses').set(auth()).set('Idempotency-Key', key).send(body({ vendor: 'Keyed', forShares: { [me]: 2, [guest]: 1 } })).expect(201);
    const replay = await request(app).post('/api/expenses').set(auth()).set('Idempotency-Key', key).send(body({ vendor: 'Keyed', forShares: { [me]: 2, [guest]: 1 } })).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    await request(app).post('/api/expenses').set(auth()).set('Idempotency-Key', key).send(body({ vendor: 'Keyed', forShares: { [me]: 1, [guest]: 3 } })).expect(409);
  });
});
