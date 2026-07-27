import * as postgresAdapter from './db.postgres';
import * as firebaseAdapter from './db.firebase';
import { logInfo } from './logger';

export type DbProvider = 'postgres' | 'memory' | 'dynamodb' | 'firebase';
// queryBlog/setPoolFactory are postgres-internal escape hatches for the trip-blog
// repository (see db.postgres.ts) — not part of the cross-provider contract, so
// they're excluded here. Every other member must line up exactly across adapters;
// keeping this a real structural type (rather than `as unknown as`) means a
// mismatched or missing export in db.firebase.ts fails `tsc`, not just at runtime.
export type DatabaseAdapter = Omit<typeof postgresAdapter, 'queryBlog' | 'setPoolFactory'>;

let cachedAdapter: DatabaseAdapter | null = null;
let cachedProvider: DbProvider | null = null;

const formatDate = (value: any) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
};

const buildMemoryAdapter = (): DatabaseAdapter => {
  // Lazy-load to avoid requiring pg-mem in production builds.
  try {
    const { createMemoryAdapter } = require('./db.memory') as typeof import('./db.memory');
    return createMemoryAdapter();
  } catch (err: any) {
    if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('pg-mem')) {
      throw new Error(
        'In-memory DB selected but pg-mem is missing. Install it in production or switch DB_PROVIDER/USE_IN_MEMORY_DB.'
      );
    }
    throw err;
  }
};

const buildNotImplementedAdapter = (provider: DbProvider): DatabaseAdapter => {
  const thrower = () => {
    throw new Error(`${provider} adapter is not implemented yet`);
  };

  const fallback: Partial<DatabaseAdapter> = {};
  for (const key of Object.keys(postgresAdapter) as Array<keyof DatabaseAdapter>) {
    (fallback as any)[key] = thrower;
  }

  return fallback as DatabaseAdapter;
};

const isLikelyCloudRun = (): boolean =>
  Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB || process.env.GOOGLE_CLOUD_PROJECT);

const normalizeProvider = (raw: string | undefined): DbProvider => {
  if (!raw || raw.trim().length === 0) return isLikelyCloudRun() ? 'firebase' : 'postgres';
  const lower = raw.toLowerCase();
  if (lower === 'postgres' || lower === 'postgresql') return 'postgres';
  if (lower === 'memory' || lower === 'inmemory' || lower === 'in-memory') return 'memory';
  if (lower === 'dynamodb') return 'dynamodb';
  if (lower === 'firebase' || lower === 'firestore') return 'firebase';
  throw new Error(`Unsupported DB_PROVIDER value: ${raw}`);
};

const detectProvider = (): DbProvider => {
  if (process.env.USE_IN_MEMORY_DB === '1') return 'memory';
  if (process.env.DB_PROVIDER && process.env.DB_PROVIDER.trim().length > 0) {
    return normalizeProvider(process.env.DB_PROVIDER);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) return 'firebase';
  return normalizeProvider(undefined);
};

const makeAdapter = (provider: DbProvider): DatabaseAdapter => {
  switch (provider) {
    case 'postgres':
      return postgresAdapter;
    case 'memory':
      return buildMemoryAdapter();
    case 'dynamodb':
      return buildNotImplementedAdapter('dynamodb');
    case 'firebase':
      return firebaseAdapter;
    default:
      // Type narrowing above should make this impossible.
      throw new Error(`Unknown database provider: ${String(provider)}`);
  }
};

export const getDbAdapter = (): DatabaseAdapter => {
  if (!cachedAdapter) {
    const provider = detectProvider();
    cachedAdapter = makeAdapter(provider);
    cachedProvider = provider;
    logInfo(
      `[db] Using ${provider} adapter${process.env.FIRESTORE_EMULATOR_HOST ? ' (FIRESTORE_EMULATOR_HOST detected)' : ''}`
    );
  }
  return cachedAdapter;
};

export const resetDbAdapter = (): void => {
  cachedAdapter = null;
  cachedProvider = null;
};

export const getCurrentDbProvider = (): DbProvider => {
  if (cachedProvider) return cachedProvider;
  return detectProvider();
};
