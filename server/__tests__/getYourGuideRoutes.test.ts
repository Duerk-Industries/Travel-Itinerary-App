import express from 'express';
import request from 'supertest';
import { HttpRateLimitExceededError } from '../src/services/httpRateLimitService';

jest.mock('../src/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: { userId: string } }).user = { userId: 'user-1' };
    next();
  },
}));
jest.mock('../src/services/getYourGuideAffiliateService', () => ({
  createGetYourGuideDescriptor: jest.fn(),
  resolveGetYourGuideRedirect: jest.fn(),
}));
jest.mock('../src/services/httpRateLimitService', () => ({
  HttpRateLimitExceededError: class HttpRateLimitExceededError extends Error {
    retryAfterSeconds = 17;
  },
  reserveRequestRateLimits: jest.fn(),
}));
jest.mock('../src/metrics', () => ({ incrementMetric: jest.fn() }));

import router from '../src/routes/getYourGuideRoutes';
const service = jest.requireMock('../src/services/getYourGuideAffiliateService') as {
  createGetYourGuideDescriptor: jest.Mock;
  resolveGetYourGuideRedirect: jest.Mock;
};
const limits = jest.requireMock('../src/services/httpRateLimitService') as { reserveRequestRateLimits: jest.Mock };
const metrics = jest.requireMock('../src/metrics') as { incrementMetric: jest.Mock };

const app = express();
app.use(express.json());
app.use('/api/affiliate', router);

describe('GetYourGuide affiliate routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    limits.reserveRequestRateLimits.mockResolvedValue(undefined);
    service.createGetYourGuideDescriptor.mockResolvedValue({ provider: 'getyourguide', kind: 'activity', token: 'g1.token', disclosureRequired: true });
    service.resolveGetYourGuideRedirect.mockResolvedValue('https://www.getyourguide.com/activity/?partner_id=test');
  });

  it('requires a valid descriptor body and returns the descriptor', async () => {
    const response = await request(app).post('/api/affiliate/getyourguide/descriptor').send({ candidate: { id: 'a' } });
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('getyourguide');
  });

  it('returns a clean unavailable response when the provider cannot issue a link', async () => {
    service.createGetYourGuideDescriptor.mockResolvedValue(null);
    const response = await request(app).post('/api/affiliate/getyourguide/descriptor').send({});
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'AFFILIATE_LINK_UNAVAILABLE' });
  });

  it('redirects with 302 and records click telemetry only with consent', async () => {
    const withoutConsent = await request(app).get('/api/affiliate/getyourguide').query({ token: 'g1.token' });
    expect(withoutConsent.status).toBe(302);
    expect(withoutConsent.headers.location).toContain('partner_id=test');
    expect(metrics.incrementMetric).not.toHaveBeenCalled();

    await request(app).get('/api/affiliate/getyourguide').set('X-Analytics-Consent', 'granted').query({ token: 'g1.token' });
    expect(metrics.incrementMetric).toHaveBeenCalledWith('getyourguide_affiliate_click', { kind: 'activity' });
  });

  it('does not redirect invalid tokens', async () => {
    service.resolveGetYourGuideRedirect.mockResolvedValue(null);
    const response = await request(app).get('/api/affiliate/getyourguide').query({ token: 'invalid' });
    expect(response.status).toBe(404);
    expect(response.headers.location).toBeUndefined();
  });

  it('returns Retry-After for internal rate limiting', async () => {
    limits.reserveRequestRateLimits.mockRejectedValue(new HttpRateLimitExceededError());
    const response = await request(app).get('/api/affiliate/getyourguide').query({ token: 'g1.token' });
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('17');
    expect(response.body).toEqual({ error: 'RATE_LIMITED' });
  });
});
