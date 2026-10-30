import request from 'supertest';
import { app } from '../src/app';

it('waits for seeded application data in E2E mode while preserving ordinary liveness', async () => {
  const previousMode = process.env.E2E_MODE;
  const previousReady: unknown = app.locals.e2eReady;
  try {
    process.env.E2E_MODE = '1';
    delete app.locals.e2eReady;
    expect((await request(app).get('/api/healthz')).status).toBe(503);
    app.locals.e2eReady = true;
    expect((await request(app).get('/api/healthz')).body.ok).toBe(true);
    process.env.E2E_MODE = '0';
    app.locals.e2eReady = false;
    expect((await request(app).get('/api/healthz')).status).toBe(200);
  } finally {
    app.locals.e2eReady = previousReady;
    if (previousMode === undefined) delete process.env.E2E_MODE;
    else process.env.E2E_MODE = previousMode;
  }
});
