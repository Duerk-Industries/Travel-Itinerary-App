/// <reference types="jest" />
/// <reference types="node" />
describe('resolveJobQueueMode', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    // Strip the env vars the resolver reads so each test sets them explicitly.
    delete process.env.INGESTION_JOB_QUEUE_MODE;
    delete process.env.INGESTION_WORKER_BASE_URL;
    delete process.env.BACKEND_URL;
    delete process.env.WEB_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // Don't call jest.restoreAllMocks() — the shared test setup spies on
    // console.error / console.log and we'd unmock those.
  });

  const loadResolverWithLocalEnv = (isLocal: boolean) => {
    jest.doMock('../src/env', () => {
      const actual = jest.requireActual('../src/env');
      return { ...actual, isLocalEnv: () => isLocal };
    });
    return require('../src/ingestion/worker/jobQueue') as typeof import('../src/ingestion/worker/jobQueue');
  };

  it('returns the configured mode when in_process is set', () => {
    process.env.INGESTION_JOB_QUEUE_MODE = 'in_process';
    const { resolveJobQueueMode } = loadResolverWithLocalEnv(true);
    expect(resolveJobQueueMode()).toBe('in_process');
  });

  it('keeps cloud_run when not running locally, regardless of base URL', () => {
    process.env.INGESTION_JOB_QUEUE_MODE = 'cloud_run';
    process.env.BACKEND_URL = 'https://duerk.org';
    const { resolveJobQueueMode } = loadResolverWithLocalEnv(false);
    expect(resolveJobQueueMode()).toBe('cloud_run');
  });

  it('keeps cloud_run locally when the base URL is loopback', () => {
    process.env.INGESTION_JOB_QUEUE_MODE = 'cloud_run';
    process.env.BACKEND_URL = 'http://localhost:4000';
    const { resolveJobQueueMode } = loadResolverWithLocalEnv(true);
    expect(resolveJobQueueMode()).toBe('cloud_run');
  });

  it('treats 127.0.0.1, 0.0.0.0, and ::1 as loopback', () => {
    process.env.INGESTION_JOB_QUEUE_MODE = 'cloud_run';
    for (const url of ['http://127.0.0.1:4000', 'http://0.0.0.0:4000', 'http://[::1]:4000']) {
      jest.resetModules();
      process.env.BACKEND_URL = url;
      const { resolveJobQueueMode } = loadResolverWithLocalEnv(true);
      expect(resolveJobQueueMode()).toBe('cloud_run');
    }
  });

  it('forces in_process locally when cloud_run is configured against a remote URL', () => {
    process.env.INGESTION_JOB_QUEUE_MODE = 'cloud_run';
    process.env.BACKEND_URL = 'https://duerk.org';
    const { resolveJobQueueMode } = loadResolverWithLocalEnv(true);
    expect(resolveJobQueueMode()).toBe('in_process');
  });

  it('prefers INGESTION_WORKER_BASE_URL over BACKEND_URL when deciding loopback-ness', () => {
    process.env.INGESTION_JOB_QUEUE_MODE = 'cloud_run';
    process.env.INGESTION_WORKER_BASE_URL = 'https://prod-worker.example.com';
    process.env.BACKEND_URL = 'http://localhost:4000';
    const { resolveJobQueueMode } = loadResolverWithLocalEnv(true);
    expect(resolveJobQueueMode()).toBe('in_process');
  });

  it('treats a missing base URL as loopback (so the cloud queue throws on first enqueue rather than silently falling back)', () => {
    process.env.INGESTION_JOB_QUEUE_MODE = 'cloud_run';
    const { resolveJobQueueMode } = loadResolverWithLocalEnv(true);
    expect(resolveJobQueueMode()).toBe('cloud_run');
  });
});
