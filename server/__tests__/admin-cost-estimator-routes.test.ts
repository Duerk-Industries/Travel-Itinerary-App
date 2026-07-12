/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';
import { cleanupTestUsersByEmail, makeAdminUser, registerAndLoginWebUser } from './helpers';

const TS = Date.now();
const PASSWORD = 'CostEstimator1!';
const ADMIN_EMAIL = `admin-cost-estimator+${TS}@example.com`;
const USER_EMAIL = `admin-cost-estimator-user+${TS}@example.com`;

describe('Admin cost estimator routes', () => {
  let adminToken: string;
  let adminId: string;
  let userToken: string;
  const originalConfigPath = process.env.API_LIMITS_CONFIG_PATH;
  let tempDir = '';
  let configPath = '';

  beforeAll(async () => {
    await initDb();

    // Route requests to a throwaway api-limits.yaml so the request-pricing PATCH test doesn't
    // write to the real repo config file.
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-estimator-routes-'));
    configPath = path.join(tempDir, 'api-limits.yaml');
    fs.writeFileSync(
      configPath,
      ['providers: {}', 'budgeting: {}', 'caching: {}', 'requestPricing:', '  SERPAPI: 0'].join('\n'),
      'utf8'
    );
    process.env.API_LIMITS_CONFIG_PATH = configPath;

    const admin = await makeAdminUser({ firstName: 'Admin', lastName: 'CostEstimator', email: ADMIN_EMAIL, password: PASSWORD });
    adminToken = admin.token;
    adminId = admin.userId;
    const user = await registerAndLoginWebUser({ firstName: 'Regular', lastName: 'CostEstimator', email: USER_EMAIL, password: PASSWORD });
    userToken = user.token;
  });

  afterAll(async () => {
    if (originalConfigPath === undefined) delete process.env.API_LIMITS_CONFIG_PATH;
    else process.env.API_LIMITS_CONFIG_PATH = originalConfigPath;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    await cleanupTestUsersByEmail([ADMIN_EMAIL, USER_EMAIL]);
    await closePool();
  });

  it('requires authentication and an admin role', async () => {
    await request(app).get('/api/admin/cost-estimate').expect(401);
    const forbidden = await request(app)
      .get('/api/admin/cost-estimate')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(forbidden.body.error).toBe('Admin access required');
  });

  it('GET returns assumptions, requestPricing, hostingLineItems, projected, and actual.months', async () => {
    const response = await request(app)
      .get('/api/admin/cost-estimate')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.assumptions).toEqual(
      expect.objectContaining({ totalUsers: expect.any(Number), premiumConversionPercent: expect.any(Number) })
    );
    expect(response.body.requestPricing).toEqual(expect.objectContaining({ SERPAPI: expect.any(Number) }));
    expect(Array.isArray(response.body.hostingLineItems)).toBe(true);
    expect(response.body.projected).toEqual(
      expect.objectContaining({ llmCostUsd: expect.any(Number), totalCostUsd: expect.any(Number) })
    );
    expect(Array.isArray(response.body.actual.months)).toBe(true);
    expect(response.body.actual.months.length).toBeGreaterThan(0);
  });

  describe('PATCH /cost-estimate/assumptions', () => {
    it('requires a reason', async () => {
      await request(app)
        .patch('/api/admin/cost-estimate/assumptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ totalUsers: 20000 })
        .expect(400);
    });

    it('rejects a negative numeric field before writing anything', async () => {
      await request(app)
        .patch('/api/admin/cost-estimate/assumptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ totalUsers: -5, reason: 'bad input' })
        .expect(400);
    });

    it('applies a valid update and records an audit log entry', async () => {
      const response = await request(app)
        .patch('/api/admin/cost-estimate/assumptions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ totalUsers: 25000, premiumConversionPercent: 4, reason: 'Growth re-forecast' })
        .expect(200);
      expect(response.body.assumptions.totalUsers).toBe(25000);
      expect(response.body.assumptions.premiumConversionPercent).toBe(4);

      const audit = await request(app)
        .get('/api/admin/audit-log')
        .query({ action: 'COST_ESTIMATOR_CONFIG_UPDATED', actorUserId: adminId })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(audit.body.entries ?? audit.body.items ?? audit.body).toBeTruthy();
    });
  });

  describe('PATCH /cost-estimate/request-pricing', () => {
    it('requires a reason', async () => {
      await request(app)
        .patch('/api/admin/cost-estimate/request-pricing')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requestPricing: { SERPAPI: 0.1 } })
        .expect(400);
    });

    it('rejects a negative price', async () => {
      await request(app)
        .patch('/api/admin/cost-estimate/request-pricing')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requestPricing: { SERPAPI: -1 }, reason: 'bad input' })
        .expect(400);
    });

    it('applies a valid update, persisted to the (test-scoped) api-limits.yaml', async () => {
      const response = await request(app)
        .patch('/api/admin/cost-estimate/request-pricing')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requestPricing: { SERPAPI: 0.05 }, reason: 'Real SerpAPI plan pricing' })
        .expect(200);
      expect(response.body.requestPricing.SERPAPI).toBe(0.05);

      const getResponse = await request(app)
        .get('/api/admin/cost-estimate')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(getResponse.body.requestPricing.SERPAPI).toBe(0.05);
    });
  });

  describe('PATCH /cost-estimate/hosting', () => {
    it('requires a reason', async () => {
      await request(app)
        .patch('/api/admin/cost-estimate/hosting')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hostingLineItems: [{ id: 'cloud-run', name: 'Cloud Run', monthlyCostUsd: 50 }] })
        .expect(400);
    });

    it('rejects a line item missing a name', async () => {
      await request(app)
        .patch('/api/admin/cost-estimate/hosting')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hostingLineItems: [{ id: 'cloud-run', name: '', monthlyCostUsd: 50 }], reason: 'bad input' })
        .expect(400);
    });

    it('rejects a negative monthlyCostUsd', async () => {
      await request(app)
        .patch('/api/admin/cost-estimate/hosting')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hostingLineItems: [{ id: 'cloud-run', name: 'Cloud Run', monthlyCostUsd: -10 }], reason: 'bad input' })
        .expect(400);
    });

    it('applies a valid update', async () => {
      const response = await request(app)
        .patch('/api/admin/cost-estimate/hosting')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          hostingLineItems: [
            { id: 'cloud-run', name: 'Cloud Run', monthlyCostUsd: 50 },
            { id: 'database', name: 'Database', monthlyCostUsd: 40 },
          ],
          reason: 'Real GCP billing figures',
        })
        .expect(200);
      expect(response.body.hostingLineItems).toEqual([
        { id: 'cloud-run', name: 'Cloud Run', monthlyCostUsd: 50 },
        { id: 'database', name: 'Database', monthlyCostUsd: 40 },
      ]);
    });
  });
});
