import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigrations } from '../src/migrations/runner';

it('opts existing test users in once without resetting privacy on subsequent boots', async () => {
  const memory = newDb({ noAstCoverageCheck: true });
  const pool = new (memory.adapters.createPg().Pool)();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r1-migration-'));
  try {
    const filename = '20261108_add_blog_visibility_rules.sql';
    fs.copyFileSync(path.join(__dirname, '../migrations', filename), path.join(dir, filename));
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY,blog_default_public BOOLEAN);
      CREATE TABLE trips(id UUID PRIMARY KEY,timezone TEXT);
      CREATE TABLE trip_blogs(trip_id UUID PRIMARY KEY,public_opt_out BOOLEAN);`);
    const userId = randomUUID(), tripId = randomUUID();
    await pool.query('INSERT INTO users VALUES($1,FALSE)', [userId]);
    await pool.query('INSERT INTO trips VALUES($1,NULL)', [tripId]);
    await pool.query('INSERT INTO trip_blogs VALUES($1,TRUE)', [tripId]);
    const first = await runMigrations({ client: pool, dir, dialect: 'memory' });
    expect(first.applied).toEqual([filename]);
    expect((await pool.query('SELECT * FROM users')).rows[0].blog_default_public).toBe(true);
    expect((await pool.query('SELECT * FROM trip_blogs')).rows[0]).toMatchObject({ public_opt_out: false, early_release: false });
    await pool.query('UPDATE users SET blog_default_public=FALSE');
    await pool.query('INSERT INTO trip_blog_privacy_choices(trip_id,user_id,opt_out) VALUES($1,$2,TRUE)', [tripId, userId]);
    const second = await runMigrations({ client: pool, dir, dialect: 'memory' });
    expect(second.applied).toEqual([]);
    expect((await pool.query('SELECT * FROM users')).rows[0].blog_default_public).toBe(false);
    expect((await pool.query('SELECT * FROM trip_blog_privacy_choices')).rows[0].opt_out).toBe(true);
  } finally {
    await pool.end();
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('r1-migration-')) throw new Error('Unexpected migration test directory');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
