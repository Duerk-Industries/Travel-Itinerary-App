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
});
