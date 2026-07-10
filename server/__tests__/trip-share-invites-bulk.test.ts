/// <reference types="jest" />
/// <reference types="node" />
const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('POST /api/trips/:id/share/invites/bulk-delete', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    const helpers = require('./helpers') as typeof import('./helpers');
    await helpers.seedTiersForTest();
    await db.setFeatureFlag('trip_sharing', true, null);
  });

  const createOwnerWithTrip = async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');

    const owner = await helpers.registerAndLoginWebUser({
      firstName: 'Trip', lastName: 'Owner',
      email: `bulk-share-owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
      password: 'secret123',
    });

    const groupsRes = await request(app)
      .get('/api/groups')
      .set({ Authorization: `Bearer ${owner.token}` })
      .expect(200);
    const groupId = groupsRes.body[0]?.id as string;

    const tripRes = await request(app)
      .post('/api/trips')
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ name: `Bulk Share ${Date.now()}`, groupId })
      .expect(201);

    return { owner, tripId: tripRes.body.id as string };
  };

  const createInvite = async (
    token: string,
    tripId: string,
    email: string,
    role: 'member' | 'follower' = 'member',
  ): Promise<string> => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const res = await request(app)
      .post(`/api/trips/${tripId}/share/invites`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ invites: [{ email, role }] })
      .expect(201);
    return res.body.invites[0].id as string;
  };

  it('rejects empty ids with 400', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const { owner, tripId } = await createOwnerWithTrip();

    await request(app)
      .post(`/api/trips/${tripId}/share/invites/bulk-delete`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ ids: [] })
      .expect(400);
  });

  it('rejects >100 ids at the DTO level with 400', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const { owner, tripId } = await createOwnerWithTrip();
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);

    await request(app)
      .post(`/api/trips/${tripId}/share/invites/bulk-delete`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ ids })
      .expect(400);
  });

  it('returns 200 and revokes every invite on full success', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const { owner, tripId } = await createOwnerWithTrip();

    const i1 = await createInvite(owner.token, tripId, `guest1-${Date.now()}@example.com`);
    const i2 = await createInvite(owner.token, tripId, `guest2-${Date.now()}@example.com`);

    const res = await request(app)
      .post(`/api/trips/${tripId}/share/invites/bulk-delete`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ ids: [i1, i2] })
      .expect(200);

    expect(new Set(res.body.revokedIds)).toEqual(new Set([i1, i2]));
    expect(res.body.failed).toEqual([]);
  });

  it('returns 207 Multi-Status when the underlying revoke throws for one id', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const db = require('../src/db') as typeof import('../src/db');
    const { owner, tripId } = await createOwnerWithTrip();
    const okId = await createInvite(owner.token, tripId, `ok-${Date.now()}@example.com`);
    const failId = await createInvite(owner.token, tripId, `boom-${Date.now()}@example.com`);

    // Simulate a per-id backend failure for exactly one invite. The real
    // revoke is lenient (0-rows is a no-op), so we mock one targeted throw
    // to exercise the bulk handler's 207 path.
    const realRevoke = db.revokeTripShareInvite;
    const spy = jest
      .spyOn(db, 'revokeTripShareInvite')
      .mockImplementation(async (actorId, trip, inviteId) => {
        if (inviteId === failId) throw new Error('Simulated DB failure');
        return realRevoke(actorId, trip, inviteId);
      });

    try {
      const res = await request(app)
        .post(`/api/trips/${tripId}/share/invites/bulk-delete`)
        .set({ Authorization: `Bearer ${owner.token}` })
        .send({ ids: [okId, failId] })
        .expect(207);

      expect(res.body.revokedIds).toEqual([okId]);
      expect(res.body.failed).toHaveLength(1);
      expect(res.body.failed[0].id).toBe(failId);
      expect(res.body.failed[0].reason).toMatch(/Simulated DB failure/);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns 403 when every id fails with "not authorized" (non-owner caller)', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const helpers = require('./helpers') as typeof import('./helpers');
    const { owner, tripId } = await createOwnerWithTrip();
    const goodId = await createInvite(owner.token, tripId, `auth-${Date.now()}@example.com`);

    const stranger = await helpers.registerAndLoginWebUser({
      firstName: 'Stranger', lastName: 'Test',
      email: `bulk-share-stranger-${Date.now()}@example.com`,
      password: 'secret123',
    });

    const res = await request(app)
      .post(`/api/trips/${tripId}/share/invites/bulk-delete`)
      .set({ Authorization: `Bearer ${stranger.token}` })
      .send({ ids: [goodId] })
      .expect(403);
    expect(res.body.error).toMatch(/not authorized/i);
  });

  it('dedupes repeated ids in the payload', async () => {
    const request = require('supertest') as typeof import('supertest');
    const { app } = require('../src/app') as typeof import('../src/app');
    const { owner, tripId } = await createOwnerWithTrip();
    const inviteId = await createInvite(owner.token, tripId, `dedup-${Date.now()}@example.com`);

    const res = await request(app)
      .post(`/api/trips/${tripId}/share/invites/bulk-delete`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ ids: [inviteId, inviteId, inviteId] })
      .expect(200);

    expect(res.body.revokedIds).toEqual([inviteId]);
  });
});
