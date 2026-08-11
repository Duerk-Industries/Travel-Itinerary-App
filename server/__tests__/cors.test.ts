import request from 'supertest';
import { app } from '../src/app';

describe('CORS configuration', () => {
  it('allows the Idempotency-Key header used by AI itinerary generation requests', async () => {
    // Without this, the browser's CORS preflight rejects the actual POST
    // /api/itinerary/async request before it ever reaches the server,
    // silently breaking AI itinerary generation from the trip wizard.
    const res = await request(app)
      .options('/api/itinerary/async')
      .set('Origin', 'http://localhost:8081')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, Authorization, Idempotency-Key');

    expect(res.status).toBeLessThan(300);
    const allowHeaders = String(res.headers['access-control-allow-headers'] ?? '').toLowerCase();
    expect(allowHeaders).toContain('idempotency-key');
  });

  it('allows requests from the production wander-bunnies.com origin', async () => {
    // Regression test: wander-bunnies.com is the app's canonical production domain
    // (app.ts defaults webUrl to it), but the deployed BACKEND_URL env var points at
    // the legacy duerk.org domain instead, and wander-bunnies.com was never added to
    // AUTH_REDIRECT_URI_ALLOWLIST. Every fetch() call from wander-bunnies.com (e.g.
    // saving an activity) failed CORS preflight with a 500 until app.ts started
    // always allowing it regardless of env config. Deliberately does not rely on any
    // env var so it stays reliable in CI, where server/.env doesn't exist.
    const res = await request(app)
      .options('/api/activities')
      .set('Origin', 'https://wander-bunnies.com')
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'Content-Type, Authorization');

    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('https://wander-bunnies.com');
  });
});
