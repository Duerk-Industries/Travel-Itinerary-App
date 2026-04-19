import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Unified server test bootstrap.
// Supports three DB providers via DB_PROVIDER env var:
//   - firebase  (default) — requires Firestore emulator at FIRESTORE_EMULATOR_HOST
//   - postgres  — requires DATABASE_URL
//   - memory    — in-process pg-mem, no external dependencies

const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.secrets'),
  path.resolve(__dirname, '../../.secrets'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

jest.setTimeout(30000);

if (process.env.SHOW_TEST_LOGS !== '1') {
  if (!(console.log as any)._isMockFunction) jest.spyOn(console, 'log').mockImplementation(() => {});
  if (!(console.info as any)._isMockFunction) jest.spyOn(console, 'info').mockImplementation(() => {});
  if (!(console.warn as any)._isMockFunction) jest.spyOn(console, 'warn').mockImplementation(() => {});
  if (!(console.error as any)._isMockFunction) jest.spyOn(console, 'error').mockImplementation(() => {});
}

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DB_PROVIDER = process.env.DB_PROVIDER ?? 'firebase';
process.env.GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID ?? 'jest-firebase-test-project';
process.env.INGESTION_JOB_QUEUE_MODE = 'in_process';

if (process.env.DB_PROVIDER === 'memory') {
  // pg-mem: mock the pg module with an in-memory implementation
  const { newDb, DataType } = require('pg-mem');
  const { randomUUID } = require('crypto');
  const db = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const pgMem = db.adapters.createPg();
  jest.mock('pg', () => pgMem);

  const formatDate = (value: any) => {
    if (value == null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 10);
  };
  db.public.registerFunction({ name: 'to_char', args: [DataType.date, DataType.text], returns: DataType.text, implementation: formatDate });
  db.public.registerFunction({ name: 'to_char', args: [DataType.timestamp, DataType.text], returns: DataType.text, implementation: formatDate });
  db.public.registerFunction({
    name: 'nullif',
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (value: string | null, compare: string | null) => {
      if (value == null) return null;
      return value === compare ? null : value;
    },
  });
  db.public.registerFunction({
    name: 'replace',
    args: [DataType.text, DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (value: string | null, find: string | null, replaceWith: string | null) => {
      if (value == null || find == null || replaceWith == null) return value;
      return value.split(find).join(replaceWith);
    },
  });
  db.public.registerFunction({ name: 'uuid_generate_v4', args: [], returns: DataType.uuid, implementation: () => randomUUID() });

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'pg-mem://localhost/test';
  }
  process.env.USE_IN_MEMORY_DB = '1';
  delete process.env.E2E_MODE;
  delete process.env.FIRESTORE_EMULATOR_HOST;
} else if (process.env.DB_PROVIDER === 'firebase') {
  process.env.E2E_MODE = process.env.E2E_MODE ?? '1';
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  delete process.env.USE_IN_MEMORY_DB;
} else if (process.env.DB_PROVIDER === 'postgres') {
  delete process.env.USE_IN_MEMORY_DB;
  delete process.env.E2E_MODE;
  delete process.env.FIRESTORE_EMULATOR_HOST;
}
