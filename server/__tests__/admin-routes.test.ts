import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool, addUserEmail, markAccountEmailVerified, listAuditLog } from '../src/db';
import { makeAdminUser, registerAndLoginWebUser, seedTiersForTest, cleanupTestUsersByEmail } from './helpers';

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
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/users/:userId/tier
  // ---------------------------------------------------------------------------

  describe('PATCH /api/admin/users/:userId/tier', () => {
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
    it('returns a feature flags list', async () => {
      const res = await request(app)
        .get('/api/admin/features')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('features');
      expect(Array.isArray(res.body.features)).toBe(true);
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
});
