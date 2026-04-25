import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool, setUserRole } from '../src/db';
import { resetApiUsageSummaries } from '../src/apis/usageLimiter';
import { registerAndLoginWebUser, seedTiersForTest, cleanupTestUsersByEmail, setUserTierInDb } from './helpers';
import { FlightParserConfigurator } from '../src/services/flightParserLLM';

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
    
    // Mock the parser dynamically to avoid jest.mock module hoisting issues that can break app init
    jest.spyOn(FlightParserConfigurator, 'getParser').mockReturnValue({
      parse: async () => ({
        primary: {
          carrier: 'MockAir',
          flightNumber: '123',
          departureDate: '2026-05-15',
        },
        bulk: [],
      })
    });
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

    expect(res.status).toBe(403);
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
