import { newDb, DataType } from 'pg-mem';

// Create a shared in-memory database for all test suites.
const db = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
const pgMem = db.adapters.createPg();

// Mock the 'pg' module so Pool/Client use the in-memory implementation.
jest.mock('pg', () => pgMem);

// Provide a minimal to_char implementation used in queries.
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

// Allow longer async flows in integration tests.
jest.setTimeout(30000);

// Silence expected console output so Jest only reports pass/fail lines.
const silenceConsole = () => {
  if (process.env.SHOW_TEST_LOGS === '1') return;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
};
silenceConsole();

// Provide a dummy connection string so code that validates DATABASE_URL passes.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
}

// Let server code know we're running against the in-memory adapter.
process.env.USE_IN_MEMORY_DB = '1';

export { db };
