import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser, loginWebUser } from './helpers';
import request from 'supertest';

const BOOTSTRAP_EMAIL_1 = 'bryan.duerk@gmail.com';
const BOOTSTRAP_EMAIL_2 = 'tristan.duerk@gmail.com';
const bootstrapUser1 = { firstName: 'Bryan', lastName: 'Duerk', email: BOOTSTRAP_EMAIL_1, password: 'Admin1234!' };
const bootstrapUser2 = { firstName: 'Tristan', lastName: 'Duerk', email: BOOTSTRAP_EMAIL_2, password: 'Admin1234!' };

describe('Admin bootstrap', () => {
  let pool: Pool;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [[BOOTSTRAP_EMAIL_1, BOOTSTRAP_EMAIL_2]]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [[BOOTSTRAP_EMAIL_1, BOOTSTRAP_EMAIL_2]]);
    await pool.end();
    await closePool();
  });

  it('grants role=admin on first login for bryan.duerk@gmail.com', async () => {
    const { userId } = await registerAndLoginWebUser(pool, bootstrapUser1);

    const { rows } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
    expect(rows[0]?.role).toBe('admin');
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
    const { rows: users } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [BOOTSTRAP_EMAIL_1]);
    const userId = users[0]?.id;
    expect(userId).toBeTruthy();

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE target_user_id = $1 AND action = 'ADMIN_BOOTSTRAP_GRANTED'`,
      [userId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('does not write a duplicate audit event on subsequent logins', async () => {
    const { rows: before } = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [BOOTSTRAP_EMAIL_1],
    );
    const userId = before[0]?.id;

    // Log in a second time
    await loginWebUser(bootstrapUser1);

    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM audit_log WHERE target_user_id = $1 AND action = 'ADMIN_BOOTSTRAP_GRANTED'`,
      [userId],
    );
    expect(parseInt(rows[0].count, 10)).toBe(1);
  });

  it('grants role=admin to tristan.duerk@gmail.com as well', async () => {
    const { userId } = await registerAndLoginWebUser(pool, bootstrapUser2);

    const { rows } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
    expect(rows[0]?.role).toBe('admin');
  });

  it('match is case-insensitive (uppercase email)', async () => {
    // Use a fresh user with uppercased email to test case-insensitive match
    // Re-registering the same email (already exists) — just log in with stored creds
    // Instead, test directly with the entitlement service
    const { ensureAdminBootstrap } = require('../src/services/entitlementService');
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [BOOTSTRAP_EMAIL_1],
    );
    const userId = rows[0]?.id;
    // Reset role to 'user' to test bootstrap from scratch
    await pool.query(`UPDATE users SET role = 'user' WHERE id = $1`, [userId]);
    await pool.query(`DELETE FROM audit_log WHERE target_user_id = $1 AND action = 'ADMIN_BOOTSTRAP_GRANTED'`, [userId]);

    await ensureAdminBootstrap(userId, 'BRYAN.DUERK@GMAIL.COM');

    const { rows: updated } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
    expect(updated[0]?.role).toBe('admin');
  });

  it('does not grant admin to non-bootstrap emails', async () => {
    const email = `bootstrap-other+${Date.now()}@example.com`;
    const { userId } = await registerAndLoginWebUser(pool, {
      firstName: 'Other',
      lastName: 'User',
      email,
      password: 'testpass1!',
    });

    const { rows } = await pool.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
    expect(rows[0]?.role).toBe('user');

    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  });
});
