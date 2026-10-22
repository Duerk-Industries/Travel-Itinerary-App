import request from 'supertest';
import { app } from '../src/app';

// Without these headers in the preflight response, a browser on another origin (the web dev server calling
// the API) blocks the request before it is sent.
describe('CORS preflight for headers the web app sends', () => {
  const origin = 'https://wander-bunnies.com';

  const preflight = (headers: string) =>
    request(app)
      .options('/api/account/privacy-preferences')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', headers);

  it('allows the device timezone header the analytics client adds to every request', async () => {
    const res = await preflight('authorization,x-device-timezone');
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    expect(res.headers['access-control-allow-headers']).toMatch(/x-device-timezone/i);
  });

  it('allows the conditional request header used to refresh a saved trip', async () => {
    const res = await preflight('authorization,if-none-match');
    expect(res.headers['access-control-allow-headers']).toMatch(/if-none-match/i);
  });

  it('still allows the existing headers', async () => {
    const res = await preflight('authorization,content-type,idempotency-key,x-analytics-consent,x-request-id');
    for (const name of ['authorization', 'content-type', 'idempotency-key', 'x-analytics-consent', 'x-request-id']) {
      expect(res.headers['access-control-allow-headers']).toMatch(new RegExp(name, 'i'));
    }
  });

  it('lets client code read the ETag and idempotent-replay headers', async () => {
    const res = await request(app).get('/api/auth/features').set('Origin', origin);
    expect(res.headers['access-control-expose-headers']).toMatch(/etag/i);
    expect(res.headers['access-control-expose-headers']).toMatch(/idempotent-replayed/i);
  });

  it('does not allow a header nobody asked for', async () => {
    const res = await preflight('authorization,x-not-a-real-header');
    expect(res.headers['access-control-allow-headers']).not.toMatch(/x-not-a-real-header/i);
  });
});
