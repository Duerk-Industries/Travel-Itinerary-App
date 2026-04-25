import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Minimal pg-mem-backed client that matches the MigrationClient contract.
const createPgMemClient = () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { newDb } = require('pg-mem');
  const db = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const pgMem = db.adapters.createPg();
  const pool = new pgMem.Pool();
  return {
    pool,
    query: (sql: string, params?: unknown[]) => pool.query(sql, params as unknown[]),
  };
};

const createTempMigrationsDir = (files: Array<{ name: string; sql: string }>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-runner-'));
  for (const file of files) {
    fs.writeFileSync(path.join(dir, file.name), file.sql, 'utf8');
  }
  return dir;
};

describe('migrations/runner', () => {
  it('creates schema_migrations and applies new files in lexical order', async () => {
    const { runMigrations, listAppliedMigrations } = require('../src/migrations/runner');
    const client = createPgMemClient();

    const dir = createTempMigrationsDir([
      { name: '20260101_a.sql', sql: 'CREATE TABLE alpha (id INT PRIMARY KEY);' },
      { name: '20260202_b.sql', sql: 'CREATE TABLE beta (id INT PRIMARY KEY);' },
    ]);

    const result = await runMigrations({ client, dir });
    expect(result.applied).toEqual(['20260101_a.sql', '20260202_b.sql']);
    expect(result.alreadyApplied).toEqual([]);

    const applied = await listAppliedMigrations(client);
    expect([...applied].sort()).toEqual(['20260101_a.sql', '20260202_b.sql']);
  });

  it('skips migrations that have already been applied', async () => {
    const { runMigrations } = require('../src/migrations/runner');
    const client = createPgMemClient();
    const dir = createTempMigrationsDir([
      { name: '20260101_a.sql', sql: 'CREATE TABLE alpha (id INT PRIMARY KEY);' },
    ]);

    const first = await runMigrations({ client, dir });
    expect(first.applied).toEqual(['20260101_a.sql']);

    // Add a new migration file.
    fs.writeFileSync(path.join(dir, '20260202_b.sql'), 'CREATE TABLE beta (id INT);', 'utf8');

    const second = await runMigrations({ client, dir });
    expect(second.applied).toEqual(['20260202_b.sql']);
    expect(second.alreadyApplied).toEqual(['20260101_a.sql']);
  });

  it('rolls back and surfaces an error when a migration fails', async () => {
    const { runMigrations } = require('../src/migrations/runner');
    const client = createPgMemClient();
    const dir = createTempMigrationsDir([
      { name: '20260101_good.sql', sql: 'CREATE TABLE ok (id INT PRIMARY KEY);' },
      { name: '20260202_bad.sql', sql: 'NOT VALID SQL' },
    ]);

    await expect(runMigrations({ client, dir })).rejects.toThrow(
      /Failed to apply migration 20260202_bad\.sql/
    );

    // The good migration should still be recorded as applied.
    const rows = (await client.query(
      `SELECT name FROM schema_migrations ORDER BY name ASC`
    )) as { rows: Array<{ name: string }> };
    const names = (rows.rows ?? []).map((r) => r.name);
    expect(names).toEqual(['20260101_good.sql']);
  });

  it('treats a missing directory as an empty migration set', async () => {
    const { runMigrations } = require('../src/migrations/runner');
    const client = createPgMemClient();
    const result = await runMigrations({
      client,
      dir: path.join(os.tmpdir(), `does-not-exist-${Date.now()}`),
    });
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toEqual([]);
  });

  it('skips `.rollback.sql` companion files — they are manual-only', async () => {
    const { runMigrations } = require('../src/migrations/runner');
    const client = createPgMemClient();
    const dir = createTempMigrationsDir([
      { name: '20260101_a.sql', sql: 'CREATE TABLE alpha (id INT PRIMARY KEY);' },
      { name: '20260101_a.rollback.sql', sql: 'DROP TABLE IF EXISTS alpha;' },
    ]);

    const result = await runMigrations({ client, dir });
    expect(result.applied).toEqual(['20260101_a.sql']);
    // If the rollback file had run, alpha would be gone — a subsequent
    // INSERT would throw. A successful INSERT confirms it survived.
    await expect(
      client.query(`INSERT INTO alpha (id) VALUES (1)`),
    ).resolves.toBeDefined();
  });

  it('emits a log line for each applied migration', async () => {
    const { runMigrations } = require('../src/migrations/runner');
    const client = createPgMemClient();
    const dir = createTempMigrationsDir([
      { name: '20260101_a.sql', sql: 'CREATE TABLE alpha (id INT);' },
    ]);
    const logs: string[] = [];
    await runMigrations({ client, dir, log: (msg: string) => logs.push(msg) });
    expect(logs.some((l) => l.includes('applying 20260101_a.sql'))).toBe(true);
    expect(logs.some((l) => l.includes('applied 20260101_a.sql'))).toBe(true);
  });
});
