import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { closePool, createEmailVerification, initDb } from '../src/db';

describe('phase2 identifier login + multi-email account management', () => {
  let pool: Pool;
  let tempDir = '';
  let configPath = '';
  const originalFlagsPath = process.env.AUTH_FLAGS_CONFIG_PATH;
  const user = {
    firstName: 'Phase',
    lastName: 'Two',
    email: 'phase2-main@example.com',
    password: 'testtest',
  };
  const secondaryEmail = 'phase2-alt@example.com';

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-phase2-'));
    configPath = path.join(tempDir, 'auth-flags.yaml');
    fs.writeFileSync(
      configPath,
      [
        'flags:',
        '  usernameLoginEnabled: true',
        '  multiEmailEnabled: true',
        '  appleOAuthEnabled: false',
        '  googleAutoLinkEnabled: true',
        '  enforceVerifiedEmailInvariant: true',
        '  uiProviderButtonsEnabled: true',
        'reservedUsernames:',
        '  - admin',
      ].join('\n'),
      'utf8'
    );
    process.env.AUTH_FLAGS_CONFIG_PATH = configPath;
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user.email, secondaryEmail]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user.email, secondaryEmail]);
      await pool.end();
    }
    await closePool();
    if (originalFlagsPath === undefined) {
      delete process.env.AUTH_FLAGS_CONFIG_PATH;
    } else {
      process.env.AUTH_FLAGS_CONFIG_PATH = originalFlagsPath;
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('supports login with username identifier when flag enabled', async () => {
    await request(app)
      .post('/api/web-auth/register')
      .send({ ...user, passwordConfirm: user.password })
      .expect(201);

    const userRow = await pool.query<{ id: string; username: string }>('SELECT id, username FROM users WHERE email = $1', [user.email]);
    const userId = String(userRow.rows[0]?.id ?? '');
    const username = String(userRow.rows[0]?.username ?? '');
    expect(userId).toBeTruthy();
    expect(username).toBeTruthy();

    const verification = await createEmailVerification(userId);
    await request(app).get('/api/web-auth/confirm').query({ token: verification.token }).expect(200);

    const login = await request(app)
      .post('/api/web-auth/login')
      .send({ identifier: username, password: user.password })
      .expect(200);

    expect(login.body.user?.email).toBe(user.email);
    expect(typeof login.body.token).toBe('string');
  });

  test('supports add/verify/set-primary/delete flow for secondary emails', async () => {
    const login = await request(app)
      .post('/api/web-auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(200);
    const token = String(login.body.token ?? '');
    expect(token).toBeTruthy();

    const add = await request(app)
      .post('/api/account/emails')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: secondaryEmail })
      .expect(201);
    expect(add.body.verificationRequired).toBe(true);
    const verifyToken = String(add.body.verificationToken ?? '');
    expect(verifyToken).toBeTruthy();

    await request(app).get('/api/web-auth/confirm-email').query({ token: verifyToken }).expect(200);

    const setPrimary = await request(app)
      .patch('/api/account/emails/primary')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: secondaryEmail })
      .expect(200);
    expect(Array.isArray(setPrimary.body.emails)).toBe(true);

    await request(app)
      .post('/api/web-auth/login')
      .send({ identifier: secondaryEmail, password: user.password })
      .expect(200);

    const makeMainPrimary = await request(app)
      .patch('/api/account/emails/primary')
      .set('Authorization', `Bearer ${String(setPrimary.body.token ?? token)}`)
      .send({ email: user.email })
      .expect(200);
    expect(Array.isArray(makeMainPrimary.body.emails)).toBe(true);

    await request(app)
      .delete(`/api/account/emails/${encodeURIComponent(secondaryEmail)}`)
      .set('Authorization', `Bearer ${String(makeMainPrimary.body.token ?? token)}`)
      .expect(200);
  });
});
