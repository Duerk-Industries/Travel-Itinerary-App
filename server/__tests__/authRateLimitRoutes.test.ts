import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, resetApiUsageCounters, resetDbAdapter } from '../src/db';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

const TS = Date.now();
const user = {
  firstName: 'Rate',
  lastName: 'Limited',
  email: `auth-rate-limit+${TS}@example.com`,
  password: 'TestPass1!',
};

describe('auth route rate limits', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'memory';
    process.env.USE_IN_MEMORY_DB = '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'pg-mem://localhost/auth-rate-limit';
    delete process.env.E2E_MODE;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    resetDbAdapter();
    await initDb();
  });

  beforeEach(async () => {
    process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '1';
    process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.AUTH_PASSWORD_RATE_LIMIT_MAX = '1';
    process.env.AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS = '60000';
    await resetApiUsageCounters();
  });

  afterEach(async () => {
    delete process.env.AUTH_LOGIN_RATE_LIMIT_MAX;
    delete process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS;
    delete process.env.AUTH_PASSWORD_RATE_LIMIT_MAX;
    delete process.env.AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([user.email]);
    await closePool();
  });

  it('rate-limits /api/web-auth/login by identifier and IP', async () => {
    await request(app)
      .post('/api/web-auth/login')
      .send({ email: 'missing@example.com', password: 'WrongPass1!' })
      .expect(401);

    const blocked = await request(app)
      .post('/api/web-auth/login')
      .send({ email: 'missing@example.com', password: 'WrongPass1!' })
      .expect(429);

    expect(blocked.header['retry-after']).toBeTruthy();
    expect(blocked.body.error).toMatch(/too many requests/i);
  });

  it('rate-limits legacy /api/auth/login too', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'legacy-missing@example.com', password: 'WrongPass1!' })
      .expect(401);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'legacy-missing@example.com', password: 'WrongPass1!' })
      .expect(429);
  });

  it('rate-limits password changes after authentication', async () => {
    const { token } = await registerAndLoginWebUser(user);
    await resetApiUsageCounters();

    await request(app)
      .patch('/api/account/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'WrongPass1!',
        newPassword: 'NewPass1!',
        newPasswordConfirm: 'NewPass1!',
      })
      .expect(401);

    await request(app)
      .patch('/api/account/password')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currentPassword: 'WrongPass1!',
        newPassword: 'NewPass1!',
        newPasswordConfirm: 'NewPass1!',
      })
      .expect(429);
  });
});
