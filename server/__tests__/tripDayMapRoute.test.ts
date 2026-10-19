import express from 'express';
import request from 'supertest';
jest.mock('../src/auth', () => ({ authenticate: (req: any, res: any, next: any) => { if (!req.headers.authorization) return res.status(401).end(); req.user = { userId: 'viewer' }; next(); } }));
jest.mock('../src/db', () => ({ ensureUserCanReadTrip: jest.fn(async () => ({ access: 'member' })), getLodgingById: jest.fn() }));
jest.mock('../src/services/planningPointsService', () => ({ getPlanningDayPoints: jest.fn(async () => [{ id: 'stop', kind: 'activity', title: 'Stored stop', address: 'Stored location', lat: 48.86, lng: 2.33, coordinateSource: 'catalog' }]) }));
jest.mock('../src/services/entitlementService', () => ({ isFeatureEnabled: jest.fn(async () => true) }));
jest.mock('../src/services/httpRateLimitService', () => ({ ...jest.requireActual('../src/services/httpRateLimitService'), reserveMapRenderRateLimit: jest.fn(async () => undefined) }));
jest.mock('../src/apis/usageLimiter', () => ({ ...jest.requireActual('../src/apis/usageLimiter'), reserveApiUsageOrThrow: jest.fn(async () => undefined) }));
jest.mock('../src/apis/providerBudgeting', () => ({ recordProviderRequestCost: jest.fn(async () => undefined) }));
import router from '../src/routes/staticMapRoutes';
import { ensureUserCanReadTrip } from '../src/db';
import { getPlanningDayPoints } from '../src/services/planningPointsService';
import { isFeatureEnabled } from '../src/services/entitlementService';
import { reserveApiUsageOrThrow } from '../src/apis/usageLimiter';
const app = express().use('/maps', router);
const path = '/maps/trip-day?tripId=11111111-1111-4111-8111-111111111111&dayDate=2027-05-02';
const auth = { Authorization: 'Bearer test' };
beforeEach(() => { jest.clearAllMocks(); process.env.GOOGLE_STATIC_MAPS_API_KEY = 'server-only-map-key'; });
afterEach(() => { jest.restoreAllMocks(); });
it('requires authentication and server-owned trip context before provider work', async () => {
  const provider = jest.spyOn(globalThis, 'fetch');
  await request(app).get(path).expect(401);
  await request(app).get('/maps/trip-day?points=[]').set(auth).expect(400);
  jest.mocked(ensureUserCanReadTrip).mockResolvedValueOnce(null);
  await request(app).get(path).set(auth).expect(403);
  expect(provider).not.toHaveBeenCalled(); expect(getPlanningDayPoints).not.toHaveBeenCalled();
});
it('keeps the kill switch ahead of provider work', async () => {
  jest.mocked(isFeatureEnabled).mockResolvedValueOnce(false);
  const provider = jest.spyOn(globalThis, 'fetch');
  await request(app).get(path).set(auth).expect(403);
  expect(provider).not.toHaveBeenCalled();
});
it('uses stored points, ignores injected points, bounds geometry, and never retains provider images', async () => {
  const provider = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(Buffer.from('png'), { headers: { 'Content-Type': 'image/png' } }));
  for (let i=0;i<2;i++) await request(app).get(path + '&points=' + encodeURIComponent(JSON.stringify([{ address: 'Injected address' }]))).set(auth).expect('Cache-Control','private, no-store').expect(200);
  expect(provider).toHaveBeenCalledTimes(2); expect(reserveApiUsageOrThrow).toHaveBeenCalledTimes(2);
  const url = new URL(String(provider.mock.calls[0][0]));
  expect(url.searchParams.get('markers')).toContain('48.86,2.33'); expect(url.toString()).not.toContain('Injected');
  expect(url.searchParams.get('size')).toBe('640x400');
});
it('rejects non-image and oversized upstream responses without disclosing provider text', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('provider secret', { headers: { 'Content-Type': 'text/html' } }))
    .mockResolvedValueOnce(new Response('png', { headers: { 'Content-Type': 'image/png', 'Content-Length': '9999999' } }));
  const invalid = await request(app).get(path).set(auth).expect(502); expect(JSON.stringify(invalid.body)).not.toContain('secret');
  await request(app).get(path).set(auth).expect(502);
});
it('rejects missing provider configuration before metering a request', async () => {
  delete process.env.GOOGLE_STATIC_MAPS_API_KEY; delete process.env.GOOGLE_MAPS_API_KEY;
  await request(app).get(path).set(auth).expect(503); expect(reserveApiUsageOrThrow).not.toHaveBeenCalled();
});
