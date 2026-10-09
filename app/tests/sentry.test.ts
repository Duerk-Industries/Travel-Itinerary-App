/** @jest-environment node */
/// <reference types="jest" />
/// <reference types="node" />

const SENTRY_MODULE = '@sentry/react-native';

describe('permission-aware Sentry bootstrap', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://x@o0.ingest.sentry.io/0';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.dontMock(SENTRY_MODULE);
  });

  it('does not initialize before a diagnostic pseudonym is supplied', () => {
    const init = jest.fn();
    jest.doMock(SENTRY_MODULE, () => ({ init, setUser: jest.fn(), wrap: jest.fn() }));
    const { initSentry } = require('../utils/sentry');
    expect(initSentry()).toEqual({ initialized: false, reason: 'missing-consent' });
    expect(init).not.toHaveBeenCalled();
  });

  it('initializes only after consent, with scrubbed payloads and a pseudonym', () => {
    const init = jest.fn();
    const setUser = jest.fn();
    jest.doMock(SENTRY_MODULE, () => ({ init, setUser, wrap: (component: unknown) => component }));
    const { initSentry } = require('../utils/sentry');
    expect(initSentry({ pseudonym: 'random-diagnostic-subject' })).toEqual({ initialized: true, reason: 'configured' });
    expect(init).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith({ id: 'random-diagnostic-subject' });
    const options = init.mock.calls[0][0];
    expect(options).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0.1, enableAutoSessionTracking: true });
    const event = options.beforeSend({
      user: { id: 'random-diagnostic-subject', email: 'private@example.com' },
      request: { headers: { authorization: 'Bearer secret' }, url: '/trips?name=secret' },
      breadcrumbs: [{ message: 'private' }],
      exception: { values: [{ value: 'private', stacktrace: { frames: [{ filename: 'file.ts?token=secret', vars: { token: 'secret' } }] } }] },
    });
    expect(event.request).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.user).toEqual({ id: 'random-diagnostic-subject' });
    expect(event.exception.values[0].value).toBeUndefined();
    expect(event.exception.values[0].stacktrace.frames[0]).toEqual({ filename: 'file.ts' });
  });

  it('closes and clears the user on withdrawal', async () => {
    const close = jest.fn(async () => undefined);
    const setUser = jest.fn();
    jest.doMock(SENTRY_MODULE, () => ({ init: jest.fn(), setUser, close, wrap: (component: unknown) => component }));
    const { initSentry, closeSentry, getInitState } = require('../utils/sentry');
    initSentry({ pseudonym: 'random-diagnostic-subject' });
    await closeSentry();
    expect(setUser).toHaveBeenLastCalledWith(null);
    expect(close).toHaveBeenCalledTimes(1);
    expect(getInitState()).toBeNull();
  });

  it('wraps the app without initializing the SDK at startup', () => {
    const init = jest.fn();
    const wrap = jest.fn((component: unknown) => component);
    jest.doMock(SENTRY_MODULE, () => ({ init, wrap }));
    const { wrapApp } = require('../utils/sentry');
    const Component = () => null;
    expect(wrapApp(Component)).toBe(Component);
    expect(wrap).toHaveBeenCalledWith(Component);
    expect(init).not.toHaveBeenCalled();
  });
});
