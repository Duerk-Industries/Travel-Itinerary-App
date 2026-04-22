import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool, addUserEmail, markAccountEmailVerified, listAuditLog, getCurrentUserTier, setUserRole, setUserTier } from '../src/db';
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
});
