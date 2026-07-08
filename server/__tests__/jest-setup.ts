import fs from 'fs';
import path from 'path';

// Unified server test bootstrap.
// Supports three DB providers via DB_PROVIDER env var:
//   - memory    (default) — in-process pg-mem, no external dependencies
//   - postgres  — requires DATABASE_URL
//   - firebase  — requires Firestore emulator at FIRESTORE_EMULATOR_HOST

const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.secrets'),
  path.resolve(__dirname, '../../.secrets'),
];

const parseEnvValue = (rawValue: string) => {
  const value = rawValue.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    const unquoted = value.slice(1, -1);
    return quote === '"' ? unquoted.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : unquoted;
  }
  const hashIndex = value.indexOf(' #');
  return (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim();
};

const loadEnvFile = (envPath: string) => {
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const assignment = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const equalsIndex = assignment.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = assignment.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(assignment.slice(equalsIndex + 1));
  }
};

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    loadEnvFile(envPath);
  }
}

jest.setTimeout(30000);

const suppressConsoleForTests = () => {
  if (process.env.SHOW_TEST_LOGS === '1') return;
  if (!(console.log as any)._isMockFunction) jest.spyOn(console, 'log').mockImplementation(() => {});
  if (!(console.info as any)._isMockFunction) jest.spyOn(console, 'info').mockImplementation(() => {});
  if (!(console.warn as any)._isMockFunction) jest.spyOn(console, 'warn').mockImplementation(() => {});
  if (!(console.error as any)._isMockFunction) jest.spyOn(console, 'error').mockImplementation(() => {});
};

suppressConsoleForTests();
const restoreAllMocks = jest.restoreAllMocks.bind(jest);
jest.restoreAllMocks = () => {
  const result = restoreAllMocks();
  suppressConsoleForTests();
  return result;
};

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.trim() === 'development-secret') {
  process.env.AUTH_SECRET = 'jest-auth-secret';
}
process.env.DB_PROVIDER = process.env.JEST_DB_PROVIDER ?? 'memory';
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
  const leastDate = (a: Date | string | null, b: Date | string | null) => {
    if (a == null) return b;
    if (b == null) return a;
    return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
  };
  db.public.registerFunction({ name: 'least', args: [DataType.timestamp, DataType.timestamp], returns: DataType.timestamp, implementation: leastDate });
  db.public.registerFunction({ name: 'least', args: [DataType.timestamptz, DataType.timestamptz], returns: DataType.timestamptz, implementation: leastDate });
  db.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (value: string | null) => (value ?? '').trim() });
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
