/**
 * Proves `initDb()` runs pending SQL migrations on startup (Priority 10).
 *
 * We don't try to actually write a new migration file into the shared
 * `server/migrations/` directory — that would collide with checked-in
 * migrations and persist across tests. Instead we verify that after initDb
 * runs, `schema_migrations` exists and contains every file the runner
 * would have applied.
 */
const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('initDb auto-applies migrations', () => {
  beforeEach(() => {
    jest.resetModules();
    setMemoryEnv();
  });

  afterEach(() => {
    delete process.env.INGESTION_MIGRATIONS_ON_BOOT;
  });

  it('creates schema_migrations and records each checked-in .sql file by default', async () => {
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();

    const pool = db.poolClient();

    // Every .sql file in /server/migrations should appear in schema_migrations.
    // Reading from the ledger itself proves the table exists (would throw if
    // the runner didn't fire).
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const migDir = path.join(__dirname, '..', 'migrations');
    const sqlFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

    const { rows: appliedRows } = await pool.query<{ name: string }>(
      `SELECT name FROM schema_migrations ORDER BY name ASC`,
    );
    const applied = appliedRows.map((r) => r.name);
    expect(applied).toEqual(sqlFiles);
  });

  it('respects INGESTION_MIGRATIONS_ON_BOOT=false (skips the runner entirely)', async () => {
    process.env.INGESTION_MIGRATIONS_ON_BOOT = 'false';
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();

    // With the flag off the runner never fires, so SELECTing from the
    // schema_migrations ledger throws "relation does not exist".
    const pool = db.poolClient();
    await expect(pool.query(`SELECT 1 FROM schema_migrations LIMIT 1`)).rejects.toThrow();
  });

  it('runner invoked twice is a no-op (idempotent ledger)', async () => {
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();

    const pool = db.poolClient();
    const { rows: firstRows } = await pool.query<{ name: string }>(
      `SELECT name FROM schema_migrations ORDER BY name ASC`,
    );

    // Second call goes through the runner directly (skipping the full
    // initDb since pg-mem's CREATE TABLE IF NOT EXISTS doesn't guard
    // primary-key creation; the runner's idempotency is what we care about).
    const { runMigrations } = require('../src/migrations/runner') as typeof import('../src/migrations/runner');
    const path = require('node:path') as typeof import('node:path');
    const migDir = path.join(__dirname, '..', 'migrations');
    const client = { query: (sql: string, params?: unknown[]) => pool.query(sql, params as any) };
    const second = await runMigrations({ client, dir: migDir });
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied.length).toBe(firstRows.length);
  });
});
