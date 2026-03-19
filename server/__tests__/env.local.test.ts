describe('isLocalEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.K_SERVICE;
    delete process.env.E2E_MODE;
  });

  afterEach(() => {
    jest.dontMock('fs');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('treats repo-root .local_env as a local environment marker', async () => {
    jest.doMock('fs', () => ({
      __esModule: true,
      default: {
        existsSync: (target: any) => {
          const normalized = String(target).replace(/\\/g, '/');
          return normalized.endsWith('/.local_env') && !normalized.endsWith('/server/.local_env');
        },
        readFileSync: (target: any) => {
          const normalized = String(target).replace(/\\/g, '/');
          if (normalized.endsWith('/.local_env') && !normalized.endsWith('/server/.local_env')) {
            return 'RUN_LOCAL=1\n';
          }
          throw new Error(`Unexpected read: ${normalized}`);
        },
      },
      existsSync: (target: any) => {
        const normalized = String(target).replace(/\\/g, '/');
        return normalized.endsWith('/.local_env') && !normalized.endsWith('/server/.local_env');
      },
      readFileSync: (target: any) => {
        const normalized = String(target).replace(/\\/g, '/');
        if (normalized.endsWith('/.local_env') && !normalized.endsWith('/server/.local_env')) {
          return 'RUN_LOCAL=1\n';
        }
        throw new Error(`Unexpected read: ${normalized}`);
      },
    }));

    const { isLocalEnv } = await import('../src/env');

    expect(isLocalEnv()).toBe(true);
  });
});
