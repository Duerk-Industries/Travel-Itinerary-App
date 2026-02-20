import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { createEmailVerification } from '../src/db';

export type TestUser = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

const fetchUserIdByEmail = async (pool: Pool, email: string): Promise<string> => {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId = rows[0]?.id as string | undefined;
  if (!userId) {
    throw new Error(`Unable to find user id for ${email}`);
  }
  return userId;
};

export const registerWebUser = async (user: TestUser) => {
  return request(app)
    .post('/api/web-auth/register')
    .send({ ...user, passwordConfirm: user.password })
    .expect(201);
};

export const confirmWebUser = async (pool: Pool, email: string) => {
  const userId = await fetchUserIdByEmail(pool, email);
  const verification = await createEmailVerification(userId);
  await request(app)
    .get('/api/web-auth/confirm')
    .query({ token: verification.token })
    .expect(200);
  return userId;
};

export const loginWebUser = async (user: TestUser) => {
  return request(app)
    .post('/api/web-auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
};

export const registerAndLoginWebUser = async (pool: Pool, user: TestUser) => {
  await registerWebUser(user);
  const userId = await confirmWebUser(pool, user.email);
  const login = await loginWebUser(user);
  return { token: login.body.token as string, userId };
};

export const registerDeviceUser = async (user: TestUser) => {
  return request(app)
    .post('/api/auth/register')
    .send({ ...user, passwordConfirm: user.password })
    .expect(201);
};

export const confirmDeviceUser = async (pool: Pool, email: string) => {
  const userId = await fetchUserIdByEmail(pool, email);
  const verification = await createEmailVerification(userId);
  await request(app)
    .get('/api/auth/confirm')
    .query({ token: verification.token })
    .expect(200);
  return userId;
};

export const loginDeviceUser = async (user: TestUser) => {
  return request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
};

export const registerAndLoginDeviceUser = async (pool: Pool, user: TestUser) => {
  await registerDeviceUser(user);
  const userId = await confirmDeviceUser(pool, user.email);
  const login = await loginDeviceUser(user);
  return { token: login.body.token as string, userId };
};
