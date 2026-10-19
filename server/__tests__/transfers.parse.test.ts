/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool, setUserRole } from '../src/db';
import { resetApiUsageSummaries } from '../src/apis/usageLimiter';
import { registerAndLoginWebUser, seedTiersForTest, cleanupTestUsersByEmail, setUserTierInDb } from './helpers';
import * as ingestion from '../src/ingestion/orchestrator';
import type { ExtractionResult } from '../src/ingestion/contracts';

describe('POST /api/transfers/parse', () => {
  jest.setTimeout(30000);

  const uniq = Date.now();
  const testEmail = `parse-test+${uniq}@example.com`;
  const premiumEmail = `parse-premium+${uniq}@example.com`;
  const adminEmail = `parse-admin+${uniq}@example.com`;
  
  let userToken: string;
  let premiumToken: string;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await seedTiersForTest();
    await cleanupTestUsersByEmail([testEmail, premiumEmail, adminEmail]);

    const userLogin = await registerAndLoginWebUser({ email: testEmail, password: 'TestPass1!', firstName: 'Free', lastName: 'User' });
    userToken = userLogin.token;

    const premiumLogin = await registerAndLoginWebUser({ email: premiumEmail, password: 'TestPass1!', firstName: 'Prem', lastName: 'User' });
    premiumToken = premiumLogin.token;
    await setUserTierInDb(premiumLogin.userId, 'premium');

    const adminLogin = await registerAndLoginWebUser({ email: adminEmail, password: 'TestPass1!', firstName: 'Admin', lastName: 'User' });
    adminToken = adminLogin.token;
    adminId = adminLogin.userId;
    await setUserRole(adminId, 'admin');
    
    // Paste Info uses ingestion's shared extractor; no separate flight LLM.
    jest.spyOn(ingestion, 'previewIngestionPayload').mockResolvedValue({
      parsedItems: [{ itemType: 'flight', travelerNames: ['Test Traveler'], confirmationNumber: 'DEMO123', extractedFields: { carrier: 'MockAir', flightNumber: '123', departureDate: '2026-05-15' } }],
      usageMetrics: { tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0, provider: 'test', modelName: null },
      metadata: { logicVersion: 'test', extractedAt: new Date().toISOString(), strategyName: 'Test' },
    } as ExtractionResult);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([testEmail, premiumEmail, adminEmail]);
    await closePool();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await resetApiUsageSummaries();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/transfers/parse')
      .send({ text: 'Flight to JFK on May 15' });
    expect(res.status).toBe(401);
  });

  it('rejects users without the flight_parser entitlement (free tier)', async () => {
    const res = await request(app)
      .post('/api/transfers/parse')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ text: 'Flight to JFK on May 15' });

    expect(res.status).toBe(402);
    expect(res.body.error).toContain("does not include access to 'flight_parser'");
  });

  it('allows admins to parse text', async () => {
    const res = await request(app)
      .post('/api/transfers/parse')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ text: 'Flight to JFK on May 15' });

    expect(res.status).toBe(200);
    expect(res.body.primary.carrier).toBe('MockAir');
    expect(res.body.primary.flightNumber).toBe('123');
    expect(res.body.primary.bookingReference).toBe('DEMO123');
    expect(ingestion.previewIngestionPayload).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'MANUAL_UPLOAD', dryRun: true }), expect.any(Boolean), expect.any(Boolean));
  });

  it('allows premium users to parse text', async () => {
    const res = await request(app)
      .post('/api/transfers/parse')
      .set('Authorization', `Bearer ${premiumToken}`)
      .send({ text: 'Flight to JFK on May 15' });

    expect(res.status).toBe(200);
    expect(res.body.primary.carrier).toBe('MockAir');
  });

  it('enforces API limits for LLM_PARSER', async () => {
    const res = await request(app)
      .post('/api/transfers/parse')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ text: 'Flight to JFK on May 15' });

    expect(res.status).toBe(200);
    
    const summary = await require('../src/apis/usageLimiter').getApiUsageSummary() as Array<{
      provider: string;
      caller: string;
      used: number;
    }>;
    const providerEntries = summary.filter((entry) => entry.provider === 'LLM_PARSER');
    expect(providerEntries.length).toBeGreaterThan(0);
    expect(providerEntries.some((entry) => entry.used >= 1)).toBe(true);
    expect(providerEntries.some((entry) => entry.caller === 'PARSE_FLIGHT_TEXT' && entry.used >= 1)).toBe(true);
  });
});
