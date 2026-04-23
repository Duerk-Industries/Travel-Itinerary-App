import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool, findUserByEmail, listGroupsForUser } from '../src/db';
import {
  cleanupTestUsersByEmail,
  registerAndLoginWebUser,
  loginWebUser,
} from './helpers';

describe('DELETE /api/account', () => {
  const EMAIL = 'account-delete-test@example.com';
  const PASSWORD = 'deletemetest';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([EMAIL]);
    await closePool();
  });

  afterEach(async () => {
    await cleanupTestUsersByEmail([EMAIL]);
  });

  it('returns 401 without an auth token', async () => {
    await request(app).delete('/api/account').expect(401);
  });

  it('deletes the authenticated user and returns 204', async () => {
    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Me',
      email: EMAIL,
      password: PASSWORD,
    });

    // Sanity: user exists and owns the default group
    const beforeUser = await findUserByEmail(EMAIL);
    expect(beforeUser?.id).toBe(userId);
    const groupsBefore = await listGroupsForUser(userId);
    expect(groupsBefore.length).toBeGreaterThan(0);

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const afterUser = await findUserByEmail(EMAIL);
    expect(afterUser).toBeFalsy();
  });

  it('prevents re-login after the account is deleted', async () => {
    await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Me',
      email: EMAIL,
      password: PASSWORD,
    });
    const login = await loginWebUser({
      firstName: 'Delete',
      lastName: 'Me',
      email: EMAIL,
      password: PASSWORD,
    });
    const token = login.body.token as string;

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app)
      .post('/api/web-auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(401);
  });

  it('returns 401 when the same token is replayed after deletion', async () => {
    const { token } = await registerAndLoginWebUser({
      firstName: 'Delete',
      lastName: 'Me',
      email: EMAIL,
      password: PASSWORD,
    });

    await request(app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // With the user removed, the account-profile route should reject the stale token.
    await request(app)
      .get('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
