/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';

// Object storage is the one thing a test cannot reach; everything else (auth, membership, the
// database layer on whichever provider the run uses) is real.
const stored = new Map<string, { bytes: Buffer; contentType: string }>();
jest.mock('../src/services/expenseReceiptStorage', () => ({
  receiptObjectKey: (tripId: string, expenseId: string, _type: string, nonce: string) => `expense-receipts/${tripId}/${expenseId}/${nonce}`,
  putReceiptObject: async (key: string, bytes: Buffer, contentType: string) => { stored.set(key, { bytes, contentType }); },
  createReceiptReadUrl: async (key: string) => (stored.has(key) ? `https://storage.test/${key}?sig=1` : null),
  deleteReceiptObject: async (key: string) => { stored.delete(key); },
}));

import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really a picture')]);

describe('stored expense receipt images', () => {
  const uniq = Date.now();
  const owner = { email: `receipt-a+${uniq}@example.com`, firstName: 'Receipt', lastName: 'Owner', password: 'testtest' };
  const stranger = { email: `receipt-b+${uniq}@example.com`, firstName: 'Receipt', lastName: 'Stranger', password: 'testtest' };
  let token: string;
  let strangerToken: string;
  let tripId: string;
  let expenseId: string;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const upload = (id: string, bytes: Buffer, type = 'image/png', t = token) =>
    request(app).put(`/api/expenses/${id}/receipt`).set(auth(t)).attach('image', bytes, { filename: 'receipt', contentType: type });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    const login = await registerAndLoginWebUser(owner);
    token = login.token;
    await setUserTierInDb(login.userId, 'premium');
    const groups = await request(app).get('/api/groups').set(auth()).expect(200);
    const groupId = groups.body[0]?.id as string;
    tripId = (await request(app).post('/api/trips').set(auth()).send({ name: `Receipt Trip ${uniq}`, groupId }).expect(201)).body.id;
    const members = await request(app).get(`/api/groups/${groupId}/members`).set(auth()).expect(200);
    const memberId = members.body.find((m: any) => (m.email ?? m.userEmail) === owner.email)?.id;
    expenseId = (await request(app).post('/api/expenses').set(auth()).send({
      tripId, expenseDate: '2026-11-12', category: 'Dinner', amount: 30, currency: 'USD', payerIds: [memberId], forIds: [memberId], vendor: 'Ramen Shop',
    }).expect(201)).body.id;
    const other = await registerAndLoginWebUser(stranger);
    strangerToken = other.token;
    await setUserTierInDb(other.userId, 'premium');
  });

  afterAll(async () => {
    await closePool();
  });

  it('has no receipt until one is stored, then stores, lists and serves it through a signed URL', async () => {
    await request(app).get(`/api/expenses/${expenseId}/receipt`).set(auth()).expect(404);
    expect((await request(app).get(`/api/expenses/receipts?tripId=${tripId}`).set(auth()).expect(200)).body.expenseIds).toEqual([]);

    await upload(expenseId, PNG).expect(200);
    expect(stored.size).toBe(1);
    expect((await request(app).get(`/api/expenses/receipts?tripId=${tripId}`).set(auth()).expect(200)).body.expenseIds).toEqual([expenseId]);

    const shown = await request(app).get(`/api/expenses/${expenseId}/receipt`).set(auth()).expect(200);
    expect(shown.body).toMatchObject({ contentType: 'image/png', url: expect.stringContaining('https://storage.test/expense-receipts/') });
    expect(shown.headers['cache-control']).toContain('no-store');
    expect(shown.body).not.toHaveProperty('objectKey');
  });

  it('replacing the receipt removes the previous image', async () => {
    const before = [...stored.keys()];
    await upload(expenseId, PNG).expect(200);
    expect(stored.size).toBe(1);
    expect([...stored.keys()]).not.toEqual(before);
  });

  it('rejects files that are not the image they claim to be, and unsupported types', async () => {
    await upload(expenseId, Buffer.from('<html>not an image</html>')).expect(400);
    await upload(expenseId, PNG, 'application/pdf').expect(400);
    await request(app).put(`/api/expenses/${expenseId}/receipt`).set(auth()).expect(400);
  });

  it('keeps receipts private to the trip group', async () => {
    await request(app).get(`/api/expenses/${expenseId}/receipt`).set(auth(strangerToken)).expect(404);
    await upload(expenseId, PNG, 'image/png', strangerToken).expect(404);
    await request(app).delete(`/api/expenses/${expenseId}/receipt`).set(auth(strangerToken)).expect(404);
    expect((await request(app).get(`/api/expenses/receipts?tripId=${tripId}`).set(auth(strangerToken)).expect(200)).body.expenseIds).toEqual([]);
    await request(app).get(`/api/expenses/${expenseId}/receipt`).expect(401);
    expect(stored.size).toBe(1);
  });

  it('removes the image when the receipt or the expense is deleted', async () => {
    await request(app).delete(`/api/expenses/${expenseId}/receipt`).set(auth()).expect(204);
    expect(stored.size).toBe(0);
    await request(app).get(`/api/expenses/${expenseId}/receipt`).set(auth()).expect(404);

    await upload(expenseId, PNG).expect(200);
    expect(stored.size).toBe(1);
    await request(app).delete(`/api/expenses/${expenseId}`).set(auth()).expect(204);
    expect(stored.size).toBe(0);
  });
});
