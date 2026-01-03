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

// Allow longer async flows in integration tests.
jest.setTimeout(30000);

// Provide a dummy connection string so code that validates DATABASE_URL passes.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
}

// Let server code know we're running against the in-memory adapter.
process.env.USE_IN_MEMORY_DB = '1';

export { db };
