/// <reference types="jest" />
/// <reference types="node" />
import { app } from '../src/app';
import { initDb, closePool, getUserRole, getCurrentUserTier, findUserByEmail, listAuditLog, setUserRole, deleteAuditLog } from '../src/db';
import { registerAndLoginWebUser, loginWebUser, cleanupTestUsersByEmail } from './helpers';
import request from 'supertest';
import { getSeededTierForEmail } from '../src/services/entitlementService';

const BOOTSTRAP_EMAIL_1 = 'bryan.duerk@gmail.com';
const BOOTSTRAP_EMAIL_2 = 'tristan.duerk@gmail.com';
const bootstrapUser1 = { firstName: 'Bryan', lastName: 'Duerk', email: BOOTSTRAP_EMAIL_1, password: 'Admin1234!' };
const bootstrapUser2 = { firstName: 'Tristan', lastName: 'Duerk', email: BOOTSTRAP_EMAIL_2, password: 'Admin1234!' };

describe('Admin bootstrap', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([BOOTSTRAP_EMAIL_1, BOOTSTRAP_EMAIL_2]);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([BOOTSTRAP_EMAIL_1, BOOTSTRAP_EMAIL_2]);
    await closePool();
  });

  it('grants role=admin on first login for bryan.duerk@gmail.com', async () => {
    const { userId } = await registerAndLoginWebUser(bootstrapUser1);

    const role = await getUserRole(userId);
    expect(role).toBe('admin');
  });

  it('assigns Pro tier to bootstrap admins automatically', async () => {
    const user = await findUserByEmail(BOOTSTRAP_EMAIL_1);
    const tier = await getCurrentUserTier(user!.id);
    expect(tier?.tierKey).toBe('pro');
  });

  it('JWT issued after bootstrap includes role: admin', async () => {
    // user was created in previous test; just log in again
    const res = await loginWebUser(bootstrapUser1);
    expect(res.body.token).toBeTruthy();

    // Decode payload (no crypto verify needed — we just check the claim)
    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
    expect(payload.role).toBe('admin');
  });

  it('writes an ADMIN_BOOTSTRAP_GRANTED audit_log entry on first grant', async () => {
    const user = await findUserByEmail(BOOTSTRAP_EMAIL_1);
    const userId = user?.id;
    expect(userId).toBeTruthy();

    const { entries } = await listAuditLog({ targetUserId: userId!, action: 'ADMIN_BOOTSTRAP_GRANTED' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('does not write a duplicate audit event on subsequent logins', async () => {
    const user = await findUserByEmail(BOOTSTRAP_EMAIL_1);
    const userId = user?.id;

    // Log in a second time
    await loginWebUser(bootstrapUser1);

    const { total } = await listAuditLog({ targetUserId: userId!, action: 'ADMIN_BOOTSTRAP_GRANTED' });
    expect(total).toBe(1);
  });

  it('grants role=admin to tristan.duerk@gmail.com as well', async () => {
    const { userId } = await registerAndLoginWebUser(bootstrapUser2);

    const role = await getUserRole(userId);
    expect(role).toBe('admin');
  });

  it('JWT issued by shared OAuth login includes role: admin for tristan.duerk@gmail.com', async () => {
    const res = await request(app)
      .post('/api/auth/oauth')
      .send({ email: BOOTSTRAP_EMAIL_2, provider: 'google' })
      .expect(200);

    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
    expect(payload.role).toBe('admin');
    expect(await getUserRole(payload.userId)).toBe('admin');
  });

  it('match is case-insensitive (uppercase email)', async () => {
    // Use a fresh user with uppercased email to test case-insensitive match
    // Re-registering the same email (already exists) — just log in with stored creds
    // Instead, test directly with the entitlement service
    const { ensureAdminBootstrap } = require('../src/services/entitlementService');
    const user = await findUserByEmail(BOOTSTRAP_EMAIL_1);
    const userId = user?.id;
    // Reset role to 'user' to test bootstrap from scratch
    await setUserRole(userId!, 'user');
    await deleteAuditLog({ targetUserId: userId!, action: 'ADMIN_BOOTSTRAP_GRANTED' });

    await ensureAdminBootstrap(userId, 'BRYAN.DUERK@GMAIL.COM');

    const role = await getUserRole(userId!);
    expect(role).toBe('admin');
  });

  it('does not grant admin to non-bootstrap emails', async () => {
    const email = `bootstrap-other+${Date.now()}@example.com`;
    const { userId } = await registerAndLoginWebUser({
      firstName: 'Other',
      lastName: 'User',
      email,
      password: 'testpass1!',
    });

    const role = await getUserRole(userId);
    expect(role).toBe('user');

    const { deleteWebUserAndCleanup } = require('../src/db') as typeof import('../src/db');
    await deleteWebUserAndCleanup(userId);
  });

  it('returns seeded default tiers for known seeded accounts', () => {
    expect(getSeededTierForEmail('vduerk@gmail.com')).toBe('premium');
    expect(getSeededTierForEmail('VDUERK@GMAIL.COM')).toBe('premium');
    expect(getSeededTierForEmail('jobs.duerk@gmail.com')).toBe('free');
    expect(getSeededTierForEmail('someone@example.com')).toBe('free');
  });
});
