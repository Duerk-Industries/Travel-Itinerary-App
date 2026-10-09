import request from 'supertest';
import { app } from '../src/app';

// The public blog page sends a custom X-Public-Visitor-Id header on reaction requests. If the
// CORS preflight doesn't allow it, the browser blocks the call with "NetworkError when
// attempting to fetch resource" before it ever reaches the route.
describe('public blog CORS preflight', () => {
  it.each(['PUT', 'DELETE'])('allows the visitor id header on %s reaction requests', async (method) => {
    const res = await request(app)
      .options('/public/blog/someone/some-trip/engagement/day/2030-01-01/reaction')
      .set('Origin', 'https://wander-bunnies.com')
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', 'content-type,x-public-visitor-id');
    expect(res.status).toBeLessThan(300);
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('x-public-visitor-id');
    expect(res.headers['access-control-allow-origin']).toBe('https://wander-bunnies.com');
  });
});
