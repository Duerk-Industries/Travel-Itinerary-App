import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { closePool, createWebUser, findUserByEmail, initDb } from '../src/db';

describe('phase1 username + user_emails', () => {
  let pool: Pool;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
    await closePool();
  });

  test('createWebUser assigns username and creates primary user_email', async () => {
    const email = `phase1-user-${Date.now()}@example.com`;
    const user = await createWebUser('Phase', 'One', email, 'testtest');

    const userRow = await pool.query<{ username: string | null; username_normalized: string | null }>(
      'SELECT username, username_normalized FROM users WHERE id = $1',
      [user.id]
    );
    expect(userRow.rows[0]?.username).toBeTruthy();
    expect(userRow.rows[0]?.username_normalized).toBe(userRow.rows[0]?.username);

    const emailRow = await pool.query<{ is_primary: boolean; is_verified: boolean }>(
      'SELECT is_primary, is_verified FROM user_emails WHERE user_id = $1 AND email_normalized = $2',
      [user.id, email.toLowerCase()]
    );
    expect(emailRow.rowCount).toBe(1);
    expect(emailRow.rows[0].is_primary).toBe(true);
    expect(emailRow.rows[0].is_verified).toBe(false);
  });

  test('username collisions are resolved with numeric suffixes', async () => {
    const ts = Date.now();
    const first = await createWebUser('Same', 'Name', `same-name-${ts}-a@example.com`, 'testtest');
    const second = await createWebUser('Same', 'Name', `same-name-${ts}-b@example.com`, 'testtest');

    const rows = await pool.query<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE id = $1 OR id = $2',
      [first.id, second.id]
    );
    const usernames = rows.rows.map((r) => r.username).sort();
    expect(usernames[0]).toMatch(/^samename\d*$/);
    expect(usernames[1]).toMatch(/^samename\d*$/);
    expect(new Set(usernames).size).toBe(2);
  });

  test('findUserByEmail resolves via user_emails mapping', async () => {
    const ts = Date.now();
    const user = await createWebUser('Lookup', 'Email', `lookup-${ts}@example.com`, 'testtest');
    await pool.query(
      `INSERT INTO user_emails (id, user_id, email, email_normalized, is_primary, is_verified)
       VALUES ($1, $2, $3, $4, FALSE, TRUE)`,
      [randomUUID(), user.id, `lookup-alt-${ts}@example.com`, `lookup-alt-${ts}@example.com`]
    );

    const found = await findUserByEmail(`lookup-alt-${ts}@example.com`);
    expect(found?.id).toBe(user.id);
  });
});
