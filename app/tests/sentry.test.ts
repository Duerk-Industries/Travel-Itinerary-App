/**
 * @jest-environment node
 *
 * Verifies the Sentry init helper behaves safely whether or not a DSN is
 * configured. The runtime contract:
 *  - Without EXPO_PUBLIC_SENTRY_DSN: initSentry() is a no-op and wrapApp
 *    returns the component unchanged, so a fresh checkout / unconfigured
 *    CI never errors out.
 *  - With a DSN: Sentry.init is called once with the expected shape and
 *    wrapApp delegates to Sentry.wrap.
 */
/// <reference types="jest" />
/// <reference types="node" />

const SENTRY_MODULE = '@sentry/react-native';

describe('initSentry()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_SENTRY_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.dontMock(SENTRY_MODULE);
  });

  it('is a no-op when EXPO_PUBLIC_SENTRY_DSN is missing', () => {
    const init = jest.fn();
    jest.doMock(SENTRY_MODULE, () => ({ init, wrap: (c: unknown) => c }));

    const { initSentry, getInitState } = require('../utils/sentry');
    const result = initSentry();
    expect(result).toEqual({ initialized: false, reason: 'missing-dsn' });
    expect(init).not.toHaveBeenCalled();
    expect(getInitState()).toEqual({ initialized: false, reason: 'missing-dsn' });
  });

  it('initializes when EXPO_PUBLIC_SENTRY_DSN is set, with our chosen defaults', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';
    process.env.EXPO_PUBLIC_SENTRY_ENV = 'staging';
    const init = jest.fn();
    jest.doMock(SENTRY_MODULE, () => ({ init, wrap: (c: unknown) => c }));

    const { initSentry } = require('../utils/sentry');
    const result = initSentry();
    expect(result).toEqual({ initialized: true, reason: 'configured' });
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://example@o0.ingest.sentry.io/0',
        environment: 'staging',
        tracesSampleRate: 0.1,
        enableAutoSessionTracking: true,
      }),
    );
  });

  it('ignores blank DSN strings (treats them as missing)', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = '   ';
    const init = jest.fn();
    jest.doMock(SENTRY_MODULE, () => ({ init, wrap: (c: unknown) => c }));

    const { initSentry } = require('../utils/sentry');
    expect(initSentry()).toEqual({ initialized: false, reason: 'missing-dsn' });
    expect(init).not.toHaveBeenCalled();
  });

  it('does not re-initialize on a second call', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://x@o0.ingest.sentry.io/0';
    const init = jest.fn();
    jest.doMock(SENTRY_MODULE, () => ({ init, wrap: (c: unknown) => c }));

    const { initSentry } = require('../utils/sentry');
    expect(initSentry()).toEqual({ initialized: true, reason: 'configured' });
    expect(initSentry()).toEqual({ initialized: false, reason: 'already-initialized' });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('reports module-load-failed when @sentry/react-native cannot be required', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://x@o0.ingest.sentry.io/0';
    jest.doMock(SENTRY_MODULE, () => {
      throw new Error('simulated missing native binding');
    });

    const { initSentry } = require('../utils/sentry');
    expect(initSentry()).toEqual({ initialized: false, reason: 'module-load-failed' });
  });

  it('accepts inline overrides (useful for tests / multi-tenant cases)', () => {
    const init = jest.fn();
    jest.doMock(SENTRY_MODULE, () => ({ init, wrap: (c: unknown) => c }));

    const { initSentry } = require('../utils/sentry');
    initSentry({
      dsn: 'https://override@example.com/9',
      environment: 'qa',
      tracesSampleRate: 1.0,
    });
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://override@example.com/9',
        environment: 'qa',
        tracesSampleRate: 1.0,
      }),
    );
  });
});

describe('wrapApp()', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  });

  afterEach(() => {
    jest.dontMock(SENTRY_MODULE);
  });

  it('returns the component unchanged when Sentry is not initialized', () => {
    jest.doMock(SENTRY_MODULE, () => ({ init: jest.fn(), wrap: jest.fn() }));
    const { wrapApp } = require('../utils/sentry');
    const Component = (() => null) as unknown as React.ComponentType;
    expect(wrapApp(Component)).toBe(Component);
  });

  it('delegates to Sentry.wrap when initialized', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://x@o0.ingest.sentry.io/0';
    const wrapped = () => null;
    const wrap = jest.fn(() => wrapped);
    jest.doMock(SENTRY_MODULE, () => ({ init: jest.fn(), wrap }));

    const { initSentry, wrapApp } = require('../utils/sentry');
    initSentry();
    const Component = (() => null) as unknown as React.ComponentType;
    expect(wrapApp(Component)).toBe(wrapped);
    expect(wrap).toHaveBeenCalledWith(Component);
  });
});
