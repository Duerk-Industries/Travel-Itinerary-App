import path from 'path';

// Helper to reload the db module with a fresh environment.
const loadDb = async () => {
  jest.resetModules();
  return import('../src/db');
};

const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const originalEnv = { ...process.env };
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  try {
    await fn();
  } finally {
    process.env = originalEnv;
    jest.resetModules();
  }
};

describe('db provider selection', () => {
  it('defaults to postgres when no env is set', async () => {
    await withEnv(
      {
        DB_PROVIDER: undefined,
        USE_IN_MEMORY_DB: undefined,
      },
      async () => {
        const db = await loadDb();
        expect(db.getCurrentDbProvider()).toBe('postgres');
      }
    );
  });

  it('prefers USE_IN_MEMORY_DB for backwards compatibility', async () => {
    await withEnv(
      {
        USE_IN_MEMORY_DB: '1',
        DB_PROVIDER: undefined,
      },
      async () => {
        const db = await loadDb();
        expect(db.getCurrentDbProvider()).toBe('memory');
      }
    );
  });

  it('honors DB_PROVIDER when set', async () => {
    await withEnv({ DB_PROVIDER: 'memory', USE_IN_MEMORY_DB: undefined }, async () => {
      const db = await loadDb();
      expect(db.getCurrentDbProvider()).toBe('memory');
    });

    await withEnv({ DB_PROVIDER: 'dynamodb', USE_IN_MEMORY_DB: undefined }, async () => {
      const db = await loadDb();
      expect(db.getCurrentDbProvider()).toBe('dynamodb');
    });

    await withEnv({ DB_PROVIDER: 'firebase', USE_IN_MEMORY_DB: undefined }, async () => {
      const db = await loadDb();
      expect(db.getCurrentDbProvider()).toBe('firebase');
    });
  });

  it('throws on unknown provider', async () => {
    await withEnv({ DB_PROVIDER: 'not-a-provider', USE_IN_MEMORY_DB: undefined }, async () => {
      const db = await loadDb();
      expect(() => db.getCurrentDbProvider()).toThrow(/Unsupported DB_PROVIDER/i);
    });
  });
});

describe('db lifecycle', () => {
  it('initializes and closes without error (memory)', async () => {
    await withEnv({ DB_PROVIDER: 'memory' }, async () => {
      const db = await loadDb();
      await expect(db.initDb()).resolves.toBeUndefined();
      await expect(db.closePool()).resolves.toBeUndefined();
    });
  });

  it('initializes and closes without error (postgres mocked by pg-mem)', async () => {
    await withEnv(
      {
        DB_PROVIDER: undefined,
        USE_IN_MEMORY_DB: undefined,
        DATABASE_URL: process.env.DATABASE_URL ?? 'pg-mem://localhost/test',
      },
      async () => {
        const db = await loadDb();
        await expect(db.initDb()).resolves.toBeUndefined();
        await expect(db.closePool()).resolves.toBeUndefined();
      }
    );
  });
});
