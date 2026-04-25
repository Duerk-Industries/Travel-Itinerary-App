import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { runMigrations } from '../src/migrations/runner';

const loadEnv = (): void => {
  const candidates = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.secrets'),
    path.resolve(__dirname, '../../.secrets'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
    }
  }
};

const main = async (): Promise<void> => {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    console.error('[migrate] DATABASE_URL must be set to run migrations.');
    process.exit(1);
  }
  if (databaseUrl.startsWith('pg-mem://')) {
    console.error('[migrate] pg-mem is not a valid migration target; refusing to run.');
    process.exit(1);
  }

  const migrationsDir = path.resolve(__dirname, '../migrations');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      const result = await runMigrations({
        client,
        dir: migrationsDir,
        log: (msg) => console.log(msg),
      });
      console.log(
        `[migrate] applied=${result.applied.length} skipped=${result.alreadyApplied.length}`
      );
      if (result.applied.length === 0) {
        console.log('[migrate] schema is up to date.');
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
};

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
