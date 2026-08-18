/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool, addUserEmail, markAccountEmailVerified, listAuditLog, getCurrentUserTier, setUserRole, setUserTier, upsertAiAbTestMetric, setFeatureFlag, recordItineraryGenerationMetrics } from '../src/db';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { makeAdminUser, registerAndLoginWebUser, seedTiersForTest, cleanupTestUsersByEmail } from './helpers';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ADMIN_EMAIL = `admin-routes-test+admin${Date.now()}@example.com`;
const USER_EMAIL  = `admin-routes-test+user${Date.now()}@example.com`;
const adminUser   = { firstName: 'Admin', lastName: 'Test', email: ADMIN_EMAIL, password: 'AdminPass1!' };
const regularUser = { firstName: 'Regular', lastName: 'User', email: USER_EMAIL, password: 'UserPass1!' };

// Track all emails created during tests for cleanup
const testEmails: string[] = [ADMIN_EMAIL, USER_EMAIL];

describe('Admin routes', () => {
  let adminToken: string;
  let adminUserId: string;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();

    const admin = await makeAdminUser(adminUser);
    adminToken = admin.token;
    adminUserId = admin.userId;

    const user = await registerAndLoginWebUser(regularUser);
    userToken = user.token;
    userId = user.userId;
  });

  afterEach(async () => {
    await seedTiersForTest();
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail(testEmails);
    await closePool();
  });

  // ---------------------------------------------------------------------------
  // Auth / authz guards
  // ---------------------------------------------------------------------------

  describe('authentication required', () => {
    const adminPaths = [
      ['GET',   '/api/admin/users'],
      ['GET',   '/api/admin/features'],
      ['GET',   '/api/admin/tiers'],
      ['GET',   '/api/admin/user-data'],
      ['GET',   '/api/admin/audit-log'],
      ['GET',   '/api/admin/metrics'],
      ['GET',   '/api/admin/ingestion-queue-depth'],
      ['POST',  '/api/admin/users/bulk-role'],
    ] as const;

    for (const [method, path] of adminPaths) {
      it(`${method} ${path} returns 401 without token`, async () => {
        await (request(app) as any)[method.toLowerCase()](path).expect(401);
      });

      it(`${method} ${path} returns 403 for non-admin token`, async () => {
        await (request(app) as any)[method.toLowerCase()](path)
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/users
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/users', () => {
    it('returns a paginated user list', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('filters by search query', async () => {
      const uniquePart = `admin-routes-test+user`;
      const res = await request(app)
        .get(`/api/admin/users?search=${encodeURIComponent(uniquePart)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.users.length).toBeGreaterThanOrEqual(1);
      expect(res.body.users.every((u: any) => u.email?.includes('admin-routes-test'))).toBe(true);
    });

    it('returns empty results for non-matching search', async () => {
      const res = await request(app)
        .get('/api/admin/users?search=nobody-matches-this-xyzzy9999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.users.length).toBe(0);
    });

    it('finds users by user id fragments', async () => {
      const res = await request(app)
        .get(`/api/admin/users?search=${encodeURIComponent(userId.slice(0, 8))}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.users.some((u: any) => u.id === userId)).toBe(true);
    });

    it('finds users by full name and alternate email', async () => {
      const alternateEmail = `admin-routes-test+alias${Date.now()}@example.com`;
      testEmails.push(alternateEmail);

      await addUserEmail(userId, alternateEmail);
      await markAccountEmailVerified(userId, alternateEmail);

      const byName = await request(app)
        .get('/api/admin/users?search=Regular%20User')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(byName.body.users.some((u: any) => u.id === userId)).toBe(true);

      const byAlias = await request(app)
        .get(`/api/admin/users?search=${encodeURIComponent(alternateEmail)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(byAlias.body.users.some((u: any) => u.id === userId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/users/:userId
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/users/:userId', () => {
    it('returns user detail for a valid id', async () => {
      const res = await request(app)
        .get(`/api/admin/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(userId);
      expect(res.body.email).toBe(USER_EMAIL);
      expect(res.body).toHaveProperty('usage');
    });

    it('returns 404 for an unknown user id', async () => {
      await request(app)
        .get('/api/admin/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('normalizes stale admin tiers back to Pro on fetch', async () => {
      await setUserRole(userId, 'admin');
      await setUserTier(userId, 'free', 'admin', adminUserId, 'Setting stale admin tier for normalization test');

      const res = await request(app)
        .get(`/api/admin/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.role).toBe('admin');
      expect(res.body.tierKey).toBe('pro');

      const currentTier = await getCurrentUserTier(userId);
      expect(currentTier?.tierKey).toBe('pro');
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/users/:userId/tier
  // ---------------------------------------------------------------------------

  describe('PATCH /api/admin/users/:userId/tier', () => {
    beforeEach(async () => {
      await setUserRole(userId, 'user');
      await setUserTier(userId, 'free', 'admin', adminUserId, 'Resetting test user tier before tier-route test');
    });

    it('requires reason', async () => {
      await request(app)
        .patch(`/api/admin/users/${userId}/tier`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tierKey: 'premium' })
        .expect(400);
    });

    it('requires tierKey', async () => {
      await request(app)
        .patch(`/api/admin/users/${userId}/tier`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Testing tier change' })
        .expect(400);
    });

    it('returns 404 for unknown tier key', async () => {
      await request(app)
        .patch(`/api/admin/users/${userId}/tier`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tierKey: 'nonexistent-tier', reason: 'Testing tier change' })
        .expect(404);
    });

    it('changes the tier and writes an audit log entry', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${userId}/tier`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tierKey: 'premium', reason: 'Testing tier change' })
        .expect(200);

      expect(res.body.userId).toBe(userId);
      expect(res.body.tierKey).toBe('premium');

      // Audit log entry should exist
      const auditResult = await listAuditLog({ targetUserId: userId, action: 'USER_TIER_CHANGED' });
      expect(auditResult.entries.length).toBeGreaterThanOrEqual(1);
    });

    it('keeps admin users locked to Pro when changing tier', async () => {
      await request(app)
        .patch(`/api/admin/users/${userId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin', reason: 'Promoting user for tier lock test' })
        .expect(200);

      const res = await request(app)
        .patch(`/api/admin/users/${userId}/tier`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tierKey: 'premium', reason: 'Trying to change admin tier' })
        .expect(200);

      expect(res.body.tierKey).toBe('pro');
      expect(res.body.lockedToPro).toBe(true);

      const currentTier = await getCurrentUserTier(userId);
      expect(currentTier?.tierKey).toBe('pro');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/admin/users/bulk-tier
  // ---------------------------------------------------------------------------

  describe('POST /api/admin/users/bulk-tier', () => {
    let bulkUserAId: string;
    let bulkUserBId: string;
    const bulkA = { firstName: 'Bulk', lastName: 'Alpha', email: `bulk-tier-a+${Date.now()}@example.com`, password: 'BulkPass1!' };
    const bulkB = { firstName: 'Bulk', lastName: 'Bravo', email: `bulk-tier-b+${Date.now()}@example.com`, password: 'BulkPass1!' };

    beforeAll(async () => {
      const a = await registerAndLoginWebUser(bulkA);
      const b = await registerAndLoginWebUser(bulkB);
      bulkUserAId = a.userId;
      bulkUserBId = b.userId;
      testEmails.push(bulkA.email, bulkB.email);
    });

    beforeEach(async () => {
      await setUserRole(bulkUserAId, 'user');
      await setUserRole(bulkUserBId, 'user');
      await setUserTier(bulkUserAId, 'free', 'admin', adminUserId, 'bulk test reset');
      await setUserTier(bulkUserBId, 'free', 'admin', adminUserId, 'bulk test reset');
    });

    it('rejects empty ids array with 400', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [], tierKey: 'premium', reason: 'bulk test' })
        .expect(400);
      expect(res.body.error).toBeDefined();
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it('rejects more than 100 ids with 400', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids, tierKey: 'premium', reason: 'bulk test' })
        .expect(400);
    });

    it('rejects missing or short reason with 400', async () => {
      await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkUserAId], tierKey: 'premium', reason: 'hi' })
        .expect(400);
      await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkUserAId], tierKey: 'premium' })
        .expect(400);
    });

    it('forbids non-admin callers (403 via requireAdmin)', async () => {
      await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ids: [bulkUserAId], tierKey: 'premium', reason: 'bulk test' })
        .expect(403);
    });

    it('returns 200 and applies tier change to all users on full success', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkUserAId, bulkUserBId], tierKey: 'premium', reason: 'bulk success' })
        .expect(200);

      expect(res.body.failed).toEqual([]);
      expect(res.body.updated).toHaveLength(2);
      const updatedIds = (res.body.updated as Array<{ id: string }>).map((u) => u.id);
      expect(updatedIds).toEqual(expect.arrayContaining([bulkUserAId, bulkUserBId]));

      const tierA = await getCurrentUserTier(bulkUserAId);
      const tierB = await getCurrentUserTier(bulkUserBId);
      expect(tierA?.tierKey).toBe('premium');
      expect(tierB?.tierKey).toBe('premium');

      const audit = await listAuditLog({ action: 'USER_TIER_CHANGED' });
      const bulkEntries = audit.entries.filter(
        (e) => (e.targetUserId === bulkUserAId || e.targetUserId === bulkUserBId) && e.reason === 'bulk success',
      );
      expect(bulkEntries.length).toBe(2);
    });

    it('returns 207 with per-id failures when some ids cannot be resolved', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ids: [bulkUserAId, '00000000-0000-0000-0000-000000000000'],
          tierKey: 'premium',
          reason: 'bulk partial',
        })
        .expect(207);

      expect(res.body.updated).toHaveLength(1);
      expect(res.body.updated[0].id).toBe(bulkUserAId);
      expect(res.body.failed).toHaveLength(1);
      expect(res.body.failed[0].id).toBe('00000000-0000-0000-0000-000000000000');
      expect(res.body.failed[0].reason).toMatch(/not found/i);
    });

    it('dedupes repeated ids before applying', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ids: [bulkUserAId, bulkUserAId, bulkUserAId],
          tierKey: 'premium',
          reason: 'dedup test',
        })
        .expect(200);
      expect(res.body.updated).toHaveLength(1);
    });

    it('locks admin-role targets to pro and flags lockedToPro in the response', async () => {
      await setUserRole(bulkUserAId, 'admin');
      const res = await request(app)
        .post('/api/admin/users/bulk-tier')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkUserAId, bulkUserBId], tierKey: 'free', reason: 'lock test' })
        .expect(200);

      const updatedA = (res.body.updated as Array<{ id: string; tierKey: string; lockedToPro: boolean }>).find(
        (u) => u.id === bulkUserAId,
      );
      const updatedB = (res.body.updated as Array<{ id: string; tierKey: string; lockedToPro: boolean }>).find(
        (u) => u.id === bulkUserBId,
      );
      expect(updatedA).toEqual(expect.objectContaining({ tierKey: 'pro', lockedToPro: true }));
      expect(updatedB).toEqual(expect.objectContaining({ tierKey: 'free', lockedToPro: false }));
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/admin/users/bulk-role
  // ---------------------------------------------------------------------------

  describe('POST /api/admin/users/bulk-role', () => {
    let bulkRoleAId: string;
    let bulkRoleBId: string;
    const bulkRoleA = { firstName: 'Bulk', lastName: 'Roler', email: `bulk-role-a+${Date.now()}@example.com`, password: 'BulkPass1!' };
    const bulkRoleB = { firstName: 'Bulk', lastName: 'Roler', email: `bulk-role-b+${Date.now()}@example.com`, password: 'BulkPass1!' };

    beforeAll(async () => {
      const a = await registerAndLoginWebUser(bulkRoleA);
      const b = await registerAndLoginWebUser(bulkRoleB);
      bulkRoleAId = a.userId;
      bulkRoleBId = b.userId;
      testEmails.push(bulkRoleA.email, bulkRoleB.email);
    });

    beforeEach(async () => {
      await setUserRole(bulkRoleAId, 'user');
      await setUserRole(bulkRoleBId, 'user');
    });

    it('rejects non-admin callers with 403', async () => {
      await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ ids: [bulkRoleAId], role: 'admin', reason: 'bulk test' })
        .expect(403);
    });

    it('rejects an unknown role with 400', async () => {
      await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkRoleAId], role: 'superuser', reason: 'bad role' })
        .expect(400);
    });

    it('rejects a missing reason / short reason with 400', async () => {
      await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkRoleAId], role: 'admin' })
        .expect(400);
      await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkRoleAId], role: 'admin', reason: 'hi' })
        .expect(400);
    });

    it('grants admin to all users on success and auto-assigns Pro tier', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkRoleAId, bulkRoleBId], role: 'admin', reason: 'bulk grant' })
        .expect(200);

      expect(res.body.failed).toEqual([]);
      expect(res.body.updated).toHaveLength(2);
      const updated = res.body.updated as Array<{ id: string; role: string; previousRole: string | null }>;
      expect(updated.every((u) => u.role === 'admin')).toBe(true);
      expect(updated.every((u) => u.previousRole === 'user')).toBe(true);

      // Auto-tier-to-pro side effect.
      const tierA = await getCurrentUserTier(bulkRoleAId);
      const tierB = await getCurrentUserTier(bulkRoleBId);
      expect(tierA?.tierKey).toBe('pro');
      expect(tierB?.tierKey).toBe('pro');

      // Per-id audit entries land.
      const audit = await listAuditLog({ action: 'USER_ROLE_GRANTED' });
      const reasoned = audit.entries.filter((e) => e.reason === 'bulk grant');
      expect(reasoned.length).toBeGreaterThanOrEqual(2);
    });

    it('refuses to demote the acting admin (self-protection) while still demoting the rest', async () => {
      // Pre-grant A admin so we can attempt to demote the acting admin AND A
      // in the same bulk call.
      await setUserRole(bulkRoleAId, 'admin');

      const res = await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [adminUserId, bulkRoleAId], role: 'user', reason: 'bulk demote' })
        .expect(207);

      const failedIds = (res.body.failed as Array<{ id: string; reason: string }>).map((f) => f.id);
      expect(failedIds).toContain(adminUserId);
      expect(res.body.failed[0].reason).toMatch(/revoke their own admin role/i);

      const updatedIds = (res.body.updated as Array<{ id: string; role: string }>).map((u) => u.id);
      expect(updatedIds).toContain(bulkRoleAId);
    });

    it('dedupes repeated ids in the payload', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [bulkRoleAId, bulkRoleAId, bulkRoleAId], role: 'admin', reason: 'dedup' })
        .expect(200);
      expect(res.body.updated).toHaveLength(1);
    });

    it('rejects >100 ids and empty ids at the DTO level', async () => {
      await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [], role: 'admin', reason: 'empty' })
        .expect(400);

      const tooMany = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      await request(app)
        .post('/api/admin/users/bulk-role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: tooMany, role: 'admin', reason: 'too many' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/users/:userId/role
  // ---------------------------------------------------------------------------

  describe('PATCH /api/admin/users/:userId/role', () => {
    it('requires reason', async () => {
      await request(app)
        .patch(`/api/admin/users/${userId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' })
        .expect(400);
    });

    it('rejects invalid role values', async () => {
      await request(app)
        .patch(`/api/admin/users/${userId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'superuser', reason: 'Testing role change' })
        .expect(400);
    });

    it('grants admin role and writes an audit log entry', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${userId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin', reason: 'Granting admin for test' })
        .expect(200);

      expect(res.body.userId).toBe(userId);
      expect(res.body.role).toBe('admin');

      const auditResult = await listAuditLog({ targetUserId: userId, action: 'USER_ROLE_GRANTED' });
      expect(auditResult.entries.length).toBeGreaterThanOrEqual(1);
    });

    it('upgrades a user tier to Pro when granting admin', async () => {
      await request(app)
        .patch(`/api/admin/users/${userId}/tier`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tierKey: 'free', reason: 'Resetting tier before admin promotion' })
        .expect(200);

      await request(app)
        .patch(`/api/admin/users/${userId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin', reason: 'Granting admin for tier promotion test' })
        .expect(200);

      const currentTier = await getCurrentUserTier(userId);
      expect(currentTier?.tierKey).toBe('pro');
    });

    it('revokes admin role and writes an audit log entry', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${userId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'user', reason: 'Revoking admin for test' })
        .expect(200);

      expect(res.body.role).toBe('user');

      const auditResult = await listAuditLog({ targetUserId: userId, action: 'USER_ROLE_REVOKED' });
      expect(auditResult.entries.length).toBeGreaterThanOrEqual(1);
    });

    it('prevents an admin from revoking their own role', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${adminUserId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'user', reason: 'Self-demotion attempt' })
        .expect(403);

      expect(res.body.error).toMatch(/cannot revoke/i);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/features
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/features', () => {
    it('returns the configured feature flag catalog with descriptions', async () => {
      const res = await request(app)
        .get('/api/admin/features')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('features');
      expect(Array.isArray(res.body.features)).toBe(true);
      expect(res.body.features.length).toBeGreaterThan(0);
      expect(res.body.features).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'feature_ingest_manual_upload',
            description: expect.any(String),
          }),
          expect.objectContaining({
            key: 'ai_itinerary_generation',
            description: expect.any(String),
          }),
          expect.objectContaining({
            key: 'overview_weather',
            description: expect.any(String),
          }),
        ])
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/features/:key/flag
  // ---------------------------------------------------------------------------

  describe('PATCH /api/admin/features/:key/flag', () => {
    it('requires enabled boolean', async () => {
      await request(app)
        .patch('/api/admin/features/ai_itinerary_generation/flag')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Testing feature flag' })
        .expect(400);
    });

    it('requires reason', async () => {
      await request(app)
        .patch('/api/admin/features/ai_itinerary_generation/flag')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false })
        .expect(400);
    });

    it('returns 404 for unknown feature flag key', async () => {
      await request(app)
        .patch('/api/admin/features/nonexistent_flag/flag')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false, reason: 'Toggling unknown flag' })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/tiers
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/tiers', () => {
    it('returns tier list with limits and entitlements', async () => {
      const res = await request(app)
        .get('/api/admin/tiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('tiers');
      expect(Array.isArray(res.body.tiers)).toBe(true);

      if (res.body.tiers.length > 0) {
        const tier = res.body.tiers[0];
        expect(tier).toHaveProperty('limits');
        expect(tier).toHaveProperty('entitlements');
        expect(tier).toHaveProperty('key');
      }
    });
  });

  describe('PATCH /api/admin/tiers/:tierKey/features/:featureKey', () => {
    it('rejects toggling an inherited feature on a higher tier', async () => {
      const res = await request(app)
        .patch('/api/admin/tiers/premium/features/csv_export')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isAllowed: false, reason: 'Trying to override inherited csv export' })
        .expect(409);

      expect(res.body.error).toMatch(/inherited/i);
      expect(res.body.inheritedFromTierKey).toBe('free');
    });

    it('updates an explicitly configured feature entitlement', async () => {
      const res = await request(app)
        .patch('/api/admin/tiers/free/features/cost_tracking')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isAllowed: true, reason: 'Temporarily enabling free cost tracking' })
        .expect(200);

      expect(res.body.tierKey).toBe('free');
      expect(res.body.featureKey).toBe('cost_tracking');
      expect(res.body.isAllowed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/tiers/:tierKey/limits/:limitKey
  // ---------------------------------------------------------------------------

  describe('PATCH /api/admin/tiers/:tierKey/limits/:limitKey', () => {
    it('requires limitValue number', async () => {
      await request(app)
        .patch('/api/admin/tiers/free/limits/max_active_trips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Testing limit update' })
        .expect(400);
    });

    it('requires reason', async () => {
      await request(app)
        .patch('/api/admin/tiers/free/limits/max_active_trips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ limitValue: 5 })
        .expect(400);
    });

    it('returns 404 for unknown tier key', async () => {
      await request(app)
        .patch('/api/admin/tiers/nonexistent/limits/max_active_trips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ limitValue: 5, reason: 'Updating limit on nonexistent tier' })
        .expect(404);
    });

    it('updates a tier limit and writes an audit log entry', async () => {
      const res = await request(app)
        .patch('/api/admin/tiers/free/limits/max_active_trips')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ limitValue: 5, reason: 'Increasing free trip limit for test' })
        .expect(200);

      expect(res.body.tierKey).toBe('free');
      expect(res.body.limitKey).toBe('max_active_trips');
      expect(res.body.limitValue).toBe(5);

      const auditResult = await listAuditLog({ action: 'TIER_LIMIT_UPDATED', limit: 1 });
      expect(auditResult.entries.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/user-data
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/user-data', () => {
    it('returns user data with window parameter', async () => {
      const res = await request(app)
        .get('/api/admin/user-data?window=30d')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.users)).toBe(true);
      if (res.body.users.length > 0) {
        expect(res.body.users[0]).toHaveProperty('tripCount');
        expect(res.body.users[0]).toHaveProperty('tripCreations');
        expect(res.body.users[0]).toHaveProperty('apiCalls');
      }
    });

    it('returns user data for all-time window', async () => {
      const res = await request(app)
        .get('/api/admin/user-data?window=all-time')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('users');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/audit-log
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/audit-log', () => {
    it('returns a paginated audit log', async () => {
      const res = await request(app)
        .get('/api/admin/audit-log')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('entries');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.entries)).toBe(true);
    });

    it('filters by action', async () => {
      const res = await request(app)
        .get('/api/admin/audit-log?action=USER_TIER_CHANGED')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.entries.every((e: any) => e.action === 'USER_TIER_CHANGED')).toBe(true);
    });

    it('respects limit and page parameters', async () => {
      const res = await request(app)
        .get('/api/admin/audit-log?limit=2&page=1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.entries.length).toBeLessThanOrEqual(2);
    });
  });

  describe('PATCH /api/admin/api-limits/:provider', () => {
    it('updates provider limits, writes an audit log, and persists to yaml', async () => {
      const originalConfigPath = process.env.API_LIMITS_CONFIG_PATH;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-api-limits-'));
      const tempConfigPath = path.join(tempDir, 'api-limits.yaml');
      fs.copyFileSync(path.join(__dirname, '..', 'config', 'api-limits.yaml'), tempConfigPath);
      process.env.API_LIMITS_CONFIG_PATH = tempConfigPath;

      try {
        const getRes = await request(app)
          .get('/api/admin/api-limits')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        const openAiProvider = getRes.body.providers.find((provider: any) => provider.provider === 'OPENAI');
        expect(openAiProvider).toBeTruthy();
        const wikimediaProvider = getRes.body.providers.find((provider: any) => provider.provider === 'WIKIMEDIA');
        const serpApiProvider = getRes.body.providers.find((provider: any) => provider.provider === 'SERPAPI');
        const openMeteoProvider = getRes.body.providers.find((provider: any) => provider.provider === 'OPEN_METEO');
        expect(getRes.body.getYourGuide).toEqual(expect.objectContaining({
          featureEnabled: expect.any(Boolean),
          partnerConfigured: expect.any(Boolean),
          apiConfigured: expect.any(Boolean),
          cachePermission: expect.any(Boolean),
          revenueDashboard: 'separate',
          observability: expect.objectContaining({
            cache: expect.objectContaining({ hits: expect.any(Number), stale: expect.any(Number), negative: expect.any(Number) }),
            latencyMs: expect.objectContaining({ sampleCount: expect.any(Number) }),
          }),
        }));
        expect(wikimediaProvider.callers.map((caller: any) => caller.caller)).toEqual(expect.arrayContaining([
          'ATTRACTION_DISCOVERY_WIKIPEDIA', 'ATTRACTION_WIKIPEDIA_ENRICHMENT',
          'ATTRACTION_WIKIPEDIA_SUMMARY', 'ATTRACTION_WIKIMEDIA_PAGEVIEWS',
        ]));
        expect(serpApiProvider.callers.map((caller: any) => caller.caller)).toContain('ATTRACTION_DISCOVERY_SEARCH');
        expect(openMeteoProvider.callers.map((caller: any) => caller.caller)).toContain('ITINERARY_MONTHLY_CLIMATOLOGY');

        const callers = Object.fromEntries(
          openAiProvider.callers.map((caller: any) => [caller.caller, caller.limit])
        );
        callers.ITINERARY_GENERATE_PLAN = 75;
        const budgetingModels = Object.fromEntries(
          (openAiProvider.budgetingModels ?? []).map((model: any) => [
            model.model,
            {
              inputCostPer1MTokensUsd: model.inputCostPer1MTokensUsd,
              outputCostPer1MTokensUsd: model.outputCostPer1MTokensUsd,
            },
          ])
        );
        budgetingModels.GPT_4O_MINI = {
          inputCostPer1MTokensUsd: 0.2,
          outputCostPer1MTokensUsd: 0.8,
        };

        await request(app)
          .patch('/api/admin/api-limits/OPENAI')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            window: 'day',
            windowHours: 48,
            overallLimit: 1500,
            monthlyBudgetUsd: 125,
            alertThresholdPercent: 85,
            budgetingModels,
            callers,
            reason: 'Increase OpenAI plan throughput for launch prep',
          })
          .expect(200);

        const updatedYaml = fs.readFileSync(tempConfigPath, 'utf8');
        expect(updatedYaml).toContain('windowHours: 48');
        expect(updatedYaml).toContain('overall: 1500');
        expect(updatedYaml).toContain('ITINERARY_GENERATE_PLAN: 75');
        expect(updatedYaml).toContain('monthlyBudgetUsd: 125');
        expect(updatedYaml).toContain('alertThresholdPercent: 85');
        expect(updatedYaml).toContain('inputCostPer1MTokensUsd: 0.2');
        expect(updatedYaml).toContain('outputCostPer1MTokensUsd: 0.8');

        const auditResult = await listAuditLog({ action: 'API_LIMITS_UPDATED' as any });
        expect(auditResult.entries.length).toBeGreaterThanOrEqual(1);
        expect(auditResult.entries[0].reason).toBe('Increase OpenAI plan throughput for launch prep');
      } finally {
        if (originalConfigPath) {
          process.env.API_LIMITS_CONFIG_PATH = originalConfigPath;
        } else {
          delete process.env.API_LIMITS_CONFIG_PATH;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/metrics
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/metrics', () => {
    it('returns the in-process counter snapshot with cache-ratio rollups', async () => {
      const { incrementMetric, resetMetricCountersForTests } = require('../src/metrics') as typeof import('../src/metrics');
      resetMetricCountersForTests();
      incrementMetric('unsplash.url_lookup.cache_hit');
      incrementMetric('unsplash.url_lookup.cache_hit');
      incrementMetric('unsplash.url_lookup.cache_miss');
      incrementMetric('itinerary.generation.success');

      const res = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.counters['unsplash.url_lookup.cache_hit']).toBe(2);
      expect(res.body.counters['unsplash.url_lookup.cache_miss']).toBe(1);
      expect(res.body.counters['itinerary.generation.success']).toBe(1);

      const cacheRow = res.body.cacheRatios.find((r: any) => r.namespace === 'unsplash.url_lookup');
      expect(cacheRow).toEqual({
        namespace: 'unsplash.url_lookup',
        hits: 2,
        misses: 1,
        total: 3,
        hitRate: expect.closeTo(2 / 3, 5),
      });

      expect(typeof res.body.startedAtIso).toBe('string');
      expect(typeof res.body.snapshotAtIso).toBe('string');
    });
  });

  // ---------------------------------------------------------------------------
  // AI experiments
  // ---------------------------------------------------------------------------

  describe('AI experiment routes', () => {
    it('creates a shadow experiment with audit and refuses promotion until metrics clear thresholds', async () => {
      const createReason = `Create experiment route coverage ${Date.now()}`;
      const createRes = await request(app)
        .post('/api/admin/experiments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          featureKey: 'ingestion_llm_extract',
          experimentKind: 'shadow_compare',
          name: 'Route coverage shadow experiment',
          variants: [
            { variantId: 'control', trafficPercent: 80 },
            { variantId: 'llm_shadow', trafficPercent: 20 },
          ],
          controlVariantId: 'control',
          minSampleSize: 2,
          maxDurationDays: 30,
          reason: createReason,
          actorRole: 'engineering_admin',
        })
        .expect(201);

      const experimentId = createRes.body.experiment.experimentId;
      const createAudit = await listAuditLog({ action: 'AI_EXPERIMENT_CREATED' as any });
      expect(createAudit.entries.some((entry) => entry.actorUserId === adminUserId && entry.reason === createReason)).toBe(true);

      await request(app)
        .patch(`/api/admin/experiments/${experimentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'completed',
          winningVariantId: 'llm_shadow',
          reason: 'Attempt promotion before metrics',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toMatch(/requires metrics/i);
        });

      await upsertAiAbTestMetric({
        experimentId,
        variantId: 'control',
        day: '2026-07-04',
        requestCount: 2,
        successRate: 1,
        avgQualityScore: 80,
        avgCostUsd: 0,
        avgLatencyMs: 0,
        groundTruthAgreement: 0.8,
        groundTruthSignal: 'admin_review',
      });
      await upsertAiAbTestMetric({
        experimentId,
        variantId: 'llm_shadow',
        day: '2026-07-04',
        requestCount: 2,
        successRate: 1,
        avgQualityScore: 82,
        avgCostUsd: 0.01,
        avgLatencyMs: 1000,
        groundTruthAgreement: 0.82,
        groundTruthSignal: 'admin_review',
      });

      const promoteReason = `Promote experiment route coverage ${Date.now()}`;
      await request(app)
        .patch(`/api/admin/experiments/${experimentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'completed',
          winningVariantId: 'llm_shadow',
          reason: promoteReason,
          actorRole: 'product_owner',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.experiment.winningVariantId).toBe('llm_shadow');
        });

      const promoteAudit = await listAuditLog({ action: 'AI_EXPERIMENT_PROMOTED' as any });
      const entry = promoteAudit.entries.find((item) => item.actorUserId === adminUserId && item.reason === promoteReason);
      expect(entry).toBeTruthy();
      expect((entry!.afterState as any).actorRole).toBe('product_owner');
      expect((entry!.afterState as any).promotionThresholds).toEqual(expect.objectContaining({ qualityDeltaMin: expect.any(Number) }));
    });
  });

  describe('AI provider certification routes', () => {
    it('requires contract metadata and writes an audit entry when certifying a provider', async () => {
      await request(app)
        .post('/api/admin/providers/openai/certify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Missing contract suite version' })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toMatch(/contractSuiteVersion/i);
        });

      const reason = `Certify OpenAI provider ${Date.now()}`;
      await request(app)
        .post('/api/admin/providers/openai/certify')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          contractSuiteVersion: 'contract-suite-route-test',
          reason,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.certification).toEqual(expect.objectContaining({
            providerId: 'openai',
            contractSuiteVersion: 'contract-suite-route-test',
          }));
        });

      const audit = await listAuditLog({ action: 'AI_PROVIDER_CERTIFIED' as any });
      const entry = audit.entries.find((item) => item.actorUserId === adminUserId && item.reason === reason);
      expect(entry).toBeTruthy();
      expect((entry!.afterState as any).certification.providerId).toBe('openai');
    });
  });

  describe('AI provider config routes (itinerary generator + dual-LLM ingestion parsing)', () => {
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalGeminiKey = process.env.GEMINI_API_KEY;

    beforeAll(() => {
      // Two distinct configured+registered providers so LLM A / LLM B can be set independently.
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
    });

    afterAll(() => {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
      process.env.GEMINI_API_KEY = originalGeminiKey;
    });

    it('lists the itinerary generator and both ingestion-parser LLM slots as configurable features', async () => {
      const res = await request(app)
        .get('/api/admin/ai-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const featureKeys = res.body.features.map((feature: any) => feature.featureKey);
      expect(featureKeys).toEqual(expect.arrayContaining([
        'itinerary_generation',
        'ingestion_llm_extract',
        'ingestion_llm_extract_secondary',
      ]));
    });

    it('lets an admin pick the itinerary generator LLM independently of the two ingestion-parser LLMs', async () => {
      const reason = `Set itinerary generator provider ${Date.now()}`;
      await request(app)
        .patch('/api/admin/ai-config/itinerary_generation')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ provider: 'openai', model: 'gpt-4o-mini', enabled: true, reason })
        .expect(200)
        .expect((res) => {
          expect(res.body.config).toEqual(expect.objectContaining({ featureKey: 'itinerary_generation', provider: 'openai', model: 'gpt-4o-mini' }));
        });

      const audit = await listAuditLog({ action: 'AI_PROVIDER_CONFIG_UPDATED' as any });
      expect(audit.entries.some((entry) => entry.actorUserId === adminUserId && entry.reason === reason)).toBe(true);
    });

    it('lets an admin explicitly set LLM A and LLM B for ingestion parsing to two different providers', async () => {
      const reasonA = `Set ingestion LLM A ${Date.now()}`;
      const reasonB = `Set ingestion LLM B ${Date.now()}`;

      await request(app)
        .patch('/api/admin/ai-config/ingestion_llm_extract')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ provider: 'openai', model: 'gpt-4o-mini', enabled: true, reason: reasonA })
        .expect(200);

      await request(app)
        .patch('/api/admin/ai-config/ingestion_llm_extract_secondary')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ provider: 'gemini', model: 'gemini-2.5-flash', enabled: true, reason: reasonB })
        .expect(200)
        .expect((res) => {
          expect(res.body.config).toEqual(expect.objectContaining({ featureKey: 'ingestion_llm_extract_secondary', provider: 'gemini', model: 'gemini-2.5-flash' }));
        });

      const res = await request(app)
        .get('/api/admin/ai-config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const byFeature = Object.fromEntries(res.body.features.map((feature: any) => [feature.featureKey, feature]));
      expect(byFeature.ingestion_llm_extract.provider).toBe('openai');
      expect(byFeature.ingestion_llm_extract_secondary.provider).toBe('gemini');
    });

    it('rejects an unconfigured/unregistered provider for any of the three AI feature slots', async () => {
      await request(app)
        .patch('/api/admin/ai-config/ingestion_llm_extract_secondary')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ provider: 'not_a_real_provider', model: 'whatever', enabled: true, reason: 'Should be rejected' })
        .expect(400);
    });

    it('rejects an unknown feature key', async () => {
      await request(app)
        .patch('/api/admin/ai-config/not_a_real_feature')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ provider: 'openai', model: 'gpt-4o-mini', enabled: true, reason: 'Should be rejected' })
        .expect(404);
    });
  });

  describe('Runtime settings routes (parser consensus + shadow-parse sample rates)', () => {
    it('lists the dual-LLM parser-consensus sample rate alongside the existing shadow-parse setting', async () => {
      const res = await request(app)
        .get('/api/admin/runtime-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const byKey = Object.fromEntries(res.body.settings.map((setting: any) => [setting.key, setting]));
      expect(byKey.parser_consensus_sample_rate_percent).toBeTruthy();
      expect(byKey.shadow_parse_sample_rate_percent).toBeTruthy();
      // Starting state per the current rollout: all production parsing uses both LLMs.
      expect(byKey.parser_consensus_sample_rate_percent.value).toBe('100');
    });

    it('lets an admin lower the percentage of production imports that get dual-LLM consensus parsing', async () => {
      const reason = `Lower consensus sample rate ${Date.now()}`;
      await request(app)
        .patch('/api/admin/runtime-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ settings: { parser_consensus_sample_rate_percent: '25' }, reason })
        .expect(200)
        .expect((res) => {
          const updated = res.body.settings.find((setting: any) => setting.key === 'parser_consensus_sample_rate_percent');
          expect(updated.value).toBe('25');
        });

      const audit = await listAuditLog({ action: 'ADMIN_SETTING_UPDATED' as any });
      expect(audit.entries.some((entry) => entry.actorUserId === adminUserId && entry.reason === reason)).toBe(true);

      const res = await request(app)
        .get('/api/admin/runtime-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const updated = res.body.settings.find((setting: any) => setting.key === 'parser_consensus_sample_rate_percent');
      expect(updated.value).toBe('25');
    });

    it('rejects a negative sample rate', async () => {
      await request(app)
        .patch('/api/admin/runtime-settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ settings: { parser_consensus_sample_rate_percent: '-5' }, reason: 'Should be rejected' })
        .expect(400);
    });
  });

  describe('Itinerary cache prepopulation routes', () => {
    const validLocation = { locationId: 'loc_lisbon_test', name: 'Lisbon', locationType: 'city', countryCode: 'PT', timezone: 'Europe/Lisbon' };

    afterEach(async () => {
      // Restore to the seeded default so other tests in this file aren't affected by ordering.
      await setFeatureFlag('itinerary_cache_prepopulation', false, adminUserId);
      clearFeatureFlagCacheForTesting();
    });

    it('GET status reports the configured caps and the active corpus release', async () => {
      const res = await request(app)
        .get('/api/admin/itinerary-cache/prepopulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toEqual(expect.objectContaining({
        maxLocationsPerRun: expect.any(Number),
        maxBlocksPerLocation: expect.any(Number),
        blocksByLocation: expect.any(Array),
      }));
    });

    it('rejects an empty releaseId', async () => {
      await request(app)
        .patch('/api/admin/itinerary-cache/active-release')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ releaseId: '', reason: 'Should be rejected' })
        .expect(400);
    });

    it('rejects a prepopulate run with no reason', async () => {
      await request(app)
        .post('/api/admin/itinerary-cache/prepopulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locations: [validLocation] })
        .expect(400);
    });

    it('rejects a prepopulate run with an empty locations array', async () => {
      await request(app)
        .post('/api/admin/itinerary-cache/prepopulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locations: [], reason: 'Should be rejected' })
        .expect(400);
    });

    it('rejects a schema-invalid location entry', async () => {
      await request(app)
        .post('/api/admin/itinerary-cache/prepopulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locations: [{ locationId: 'loc_bad', locationType: 'not_a_real_type', timezone: 'UTC', name: 'Bad' }], reason: 'Should be rejected' })
        .expect(400);
    });

    it('rejects more than 50 candidate locations', async () => {
      const many = Array.from({ length: 51 }, (_, i) => ({ ...validLocation, locationId: `loc_${i}` }));
      await request(app)
        .post('/api/admin/itinerary-cache/prepopulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locations: many, reason: 'Should be rejected' })
        .expect(400);
    });

    it('returns 403 when the itinerary_cache_prepopulation feature flag is disabled (the seeded default)', async () => {
      await setFeatureFlag('itinerary_cache_prepopulation', false, adminUserId);
      clearFeatureFlagCacheForTesting();
      await request(app)
        .post('/api/admin/itinerary-cache/prepopulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locations: [validLocation], reason: 'Attempt while disabled' })
        .expect(403);
    });

    // Must run before the "set the active corpus release" test below — there's no "unset" route
    // by design (a release id should never silently disappear once configured), so this is the
    // only point in the suite where an admin console pointed at a fresh environment has none set.
    it('returns 409 when the flag is enabled but no active corpus release is configured yet', async () => {
      await setFeatureFlag('itinerary_cache_prepopulation', true, adminUserId);
      clearFeatureFlagCacheForTesting();
      await request(app)
        .post('/api/admin/itinerary-cache/prepopulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locations: [validLocation], reason: 'Attempt with no release configured' })
        .expect(409);
    });

    it('lets an admin set the active corpus release, with audit logging', async () => {
      const reason = `Set active corpus release ${Date.now()}`;
      await request(app)
        .patch('/api/admin/itinerary-cache/active-release')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ releaseId: 'release-route-test', reason })
        .expect(200)
        .expect((res) => {
          expect(res.body.setting).toEqual(expect.objectContaining({ key: 'ACTIVE_CORPUS_RELEASE_ID', value: 'release-route-test' }));
        });

      const audit = await listAuditLog({ action: 'ADMIN_SETTING_UPDATED' as any });
      expect(audit.entries.some((entry) => entry.actorUserId === adminUserId && entry.reason === reason)).toBe(true);

      const status = await request(app)
        .get('/api/admin/itinerary-cache/prepopulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(status.body.activeCorpusReleaseId).toBe('release-route-test');
    });
  });

  describe('Itinerary quality gate baseline routes', () => {
    it('GET returns a null baseline when nothing has been pinned yet', async () => {
      const res = await request(app)
        .get('/api/admin/itinerary-cache/quality-baseline')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).toEqual(expect.objectContaining({ baseline: null }));
    });

    it('rejects pinning with no reason', async () => {
      await request(app)
        .patch('/api/admin/itinerary-cache/quality-baseline')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ generationId: 'gen-missing-reason' })
        .expect(400);
    });

    it('rejects pinning with no generationId', async () => {
      await request(app)
        .patch('/api/admin/itinerary-cache/quality-baseline')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Should be rejected' })
        .expect(400);
    });

    it('404s when the referenced generation has no stored evaluation', async () => {
      await request(app)
        .patch('/api/admin/itinerary-cache/quality-baseline')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ generationId: 'gen-does-not-exist', reason: 'Attempt with unknown generation' })
        .expect(404);
    });

    it('lets an admin pin a generation\'s evaluation as the baseline, with audit logging, and GET reflects it', async () => {
      const generationId = `gen-quality-baseline-test-${Date.now()}`;
      await recordItineraryGenerationMetrics({
        generationId,
        tripId: null,
        userId: adminUserId,
        provider: 'openai',
        model: 'gpt-4o-mini',
        outcome: 'success',
        tokenUsage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
        estimatedCostMicros: null,
        stageMetrics: [],
        evaluation: {
          version: 'itinerary-eval-v1',
          mustSeeCoverage: 1,
          weightedInterestCoverage: 1,
          duplicateRate: 0,
          freeOrLowCostShare: 0.5,
          hardConstraintViolations: null,
          estimatedTravelMinutesPerActivityDay: 100,
          scheduleWindowViolations: 0,
          arrivalDepartureFeasible: null,
          unsupportedFactRate: 0.1,
          llmCalls: 4,
          promptTokens: 100,
          completionTokens: 100,
          totalTokens: 200,
          latencyP50Ms: 100,
          latencyP95Ms: 200,
          groupCohesionScore: null,
          unavailableReasons: [],
        } as any,
        cacheUsage: null,
        avoidedInference: null,
        fallbackUsed: false,
        createdAt: new Date().toISOString(),
      });

      const reason = `Pin quality baseline ${Date.now()}`;
      const patchRes = await request(app)
        .patch('/api/admin/itinerary-cache/quality-baseline')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ generationId, reason })
        .expect(200);
      expect(patchRes.body.setting).toEqual(expect.objectContaining({ key: 'ITINERARY_QUALITY_BASELINE_METRICS' }));
      expect(patchRes.body.baseline).toEqual(expect.objectContaining({ unsupportedFactRate: 0.1 }));

      const audit = await listAuditLog({ action: 'ADMIN_SETTING_UPDATED' as any });
      expect(audit.entries.some((entry) => entry.actorUserId === adminUserId && entry.reason === reason)).toBe(true);

      const getRes = await request(app)
        .get('/api/admin/itinerary-cache/quality-baseline')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(getRes.body.baseline).toEqual(expect.objectContaining({ unsupportedFactRate: 0.1 }));
    });
  });

  describe('PATCH /api/admin/api-limits/caching/:group', () => {
    it('rejects fractional caching settings instead of silently flooring them', async () => {
      const originalConfigPath = process.env.API_LIMITS_CONFIG_PATH;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-api-caching-'));
      const tempConfigPath = path.join(tempDir, 'api-limits.yaml');
      fs.copyFileSync(path.join(__dirname, '..', 'config', 'api-limits.yaml'), tempConfigPath);
      process.env.API_LIMITS_CONFIG_PATH = tempConfigPath;

      try {
        await request(app)
          .patch('/api/admin/api-limits/caching/attractions')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            values: { refreshDays: 1.5 },
            reason: 'Reject fractional cache settings',
          })
          .expect(400);

        const updatedYaml = fs.readFileSync(tempConfigPath, 'utf8');
        expect(updatedYaml).not.toContain('refreshDays: 1');
      } finally {
        if (originalConfigPath) {
          process.env.API_LIMITS_CONFIG_PATH = originalConfigPath;
        } else {
          delete process.env.API_LIMITS_CONFIG_PATH;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/ingestion-queue-depth
  // ---------------------------------------------------------------------------

  describe('GET /api/admin/ingestion-queue-depth', () => {
    it('returns countsByState + active/terminal/failedRetriable totals sourced from import_jobs', async () => {
      const res = await request(app)
        .get('/api/admin/ingestion-queue-depth')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // On a clean test DB with no ingestion rows seeded, the totals are 0
      // and countsByState is empty — the endpoint still returns shape.
      expect(res.body).toMatchObject({
        countsByState: expect.any(Object),
        totalActive: expect.any(Number),
        totalTerminal: expect.any(Number),
        failedRetriable: expect.any(Number),
        snapshotAtIso: expect.any(String),
      });
    });

    // 401/403 admin-guard is covered by the `authentication required` suite.
  });
});
