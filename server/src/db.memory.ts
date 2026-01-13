import { DataType, newDb } from 'pg-mem';
import * as postgresAdapter from './db.postgres';

const formatDate = (value: any) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
};

// Build an in-memory adapter that reuses the postgres implementation against a pg-mem Pool.
export const createMemoryAdapter = () => {
  // When Jest mocks 'pg' we can reuse that Pool so tests share the same db instance.
  let poolFactory = require('pg').Pool as typeof import('pg').Pool;

  if (!process.env.JEST_WORKER_ID) {
    const db = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
    const pgMem = db.adapters.createPg();
    db.public.registerFunction({ name: 'to_char', args: [DataType.date, DataType.text], returns: DataType.text, implementation: formatDate });
    db.public.registerFunction({
      name: 'to_char',
      args: [DataType.timestamp, DataType.text],
      returns: DataType.text,
      implementation: formatDate,
    });
    poolFactory = pgMem.Pool;
  }

  postgresAdapter.setPoolFactory(poolFactory);

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'pg-mem://localhost/test';
  }
  process.env.USE_IN_MEMORY_DB = process.env.USE_IN_MEMORY_DB ?? '1';

  return {
    ...postgresAdapter,
    initDb: async () => {
      await postgresAdapter.initDb();
    },
    refreshAirportsDaily: async () => {
      return;
    },
  };
};
