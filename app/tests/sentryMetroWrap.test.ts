/**
 * @jest-environment node
 *
 * Locks in that metro.shared.cjs wraps the built config with
 * @sentry/react-native/metro's withSentryConfig for local Metro use.
 *
 * EAS native builds intentionally skip the wrapper by default because
 * @sentry/react-native 7.2.0's serializer can crash during bundle embedding
 * while extracting the Debug ID from an undefined bundle source.
 */
describe('Sentry Metro integration', () => {
  const originalNoSentryMetro = process.env.EXPO_NO_SENTRY_METRO;
  const originalEnableSentryMetro = process.env.SENTRY_ENABLE_METRO;
  const originalEasBuild = process.env.EAS_BUILD;

  afterEach(() => {
    if (originalNoSentryMetro === undefined) {
      delete process.env.EXPO_NO_SENTRY_METRO;
    } else {
      process.env.EXPO_NO_SENTRY_METRO = originalNoSentryMetro;
    }
    if (originalEnableSentryMetro === undefined) {
      delete process.env.SENTRY_ENABLE_METRO;
    } else {
      process.env.SENTRY_ENABLE_METRO = originalEnableSentryMetro;
    }
    if (originalEasBuild === undefined) {
      delete process.env.EAS_BUILD;
    } else {
      process.env.EAS_BUILD = originalEasBuild;
    }
  });

  it('wraps the shared config when @sentry/react-native/metro is installed', () => {
    delete process.env.EXPO_NO_SENTRY_METRO;
    delete process.env.SENTRY_ENABLE_METRO;
    delete process.env.EAS_BUILD;
    const calls: unknown[] = [];
    const fakeWrap = jest.fn((cfg: unknown, opts: unknown) => {
      calls.push({ cfg, opts });
      return { ...(cfg as object), __sentryWrapped: true };
    });
    jest.resetModules();
    jest.doMock('@sentry/react-native/metro', () => ({ withSentryConfig: fakeWrap }));

    const { createSharedMetroConfig } = require('../../metro.shared.cjs');
    const path = require('node:path');
    const projectRoot = path.resolve(__dirname, '..');
    const result = createSharedMetroConfig({
      projectRoot,
      primaryNodeModules: path.join(projectRoot, 'node_modules'),
      secondaryNodeModules: path.join(projectRoot, '..', 'node_modules'),
      watchFolders: [],
      blockedPaths: [],
    });

    expect(fakeWrap).toHaveBeenCalledTimes(1);
    expect((result as { __sentryWrapped?: boolean }).__sentryWrapped).toBe(true);
    // Confirm we pass the options we expect — keeping the web bundle lean
    // (no replay) and avoiding the per-component annotation babel work.
    expect(calls[0]).toMatchObject({
      opts: { includeWebReplay: false, annotateReactComponents: false },
    });
  });

  it('skips the Sentry Metro wrapper when explicitly disabled', () => {
    process.env.EXPO_NO_SENTRY_METRO = '1';
    delete process.env.SENTRY_ENABLE_METRO;
    delete process.env.EAS_BUILD;
    const fakeWrap = jest.fn((cfg: unknown) => ({ ...(cfg as object), __sentryWrapped: true }));
    jest.resetModules();
    jest.doMock('@sentry/react-native/metro', () => ({ withSentryConfig: fakeWrap }));

    const { createSharedMetroConfig } = require('../../metro.shared.cjs');
    const path = require('node:path');
    const projectRoot = path.resolve(__dirname, '..');
    const result = createSharedMetroConfig({
      projectRoot,
      primaryNodeModules: path.join(projectRoot, 'node_modules'),
      secondaryNodeModules: path.join(projectRoot, '..', 'node_modules'),
      watchFolders: [],
      blockedPaths: [],
    });

    expect(fakeWrap).not.toHaveBeenCalled();
    expect((result as { __sentryWrapped?: boolean }).__sentryWrapped).toBeUndefined();
  });

  it('skips the Sentry Metro wrapper during EAS builds by default', () => {
    delete process.env.EXPO_NO_SENTRY_METRO;
    delete process.env.SENTRY_ENABLE_METRO;
    process.env.EAS_BUILD = 'true';
    const fakeWrap = jest.fn((cfg: unknown) => ({ ...(cfg as object), __sentryWrapped: true }));
    jest.resetModules();
    jest.doMock('@sentry/react-native/metro', () => ({ withSentryConfig: fakeWrap }));

    const { createSharedMetroConfig } = require('../../metro.shared.cjs');
    const path = require('node:path');
    const projectRoot = path.resolve(__dirname, '..');
    const result = createSharedMetroConfig({
      projectRoot,
      primaryNodeModules: path.join(projectRoot, 'node_modules'),
      secondaryNodeModules: path.join(projectRoot, '..', 'node_modules'),
      watchFolders: [],
      blockedPaths: [],
    });

    expect(fakeWrap).not.toHaveBeenCalled();
    expect((result as { __sentryWrapped?: boolean }).__sentryWrapped).toBeUndefined();
  });

  it('allows opting Sentry Metro back in during EAS builds', () => {
    delete process.env.EXPO_NO_SENTRY_METRO;
    process.env.SENTRY_ENABLE_METRO = '1';
    process.env.EAS_BUILD = 'true';
    const fakeWrap = jest.fn((cfg: unknown) => ({ ...(cfg as object), __sentryWrapped: true }));
    jest.resetModules();
    jest.doMock('@sentry/react-native/metro', () => ({ withSentryConfig: fakeWrap }));

    const { createSharedMetroConfig } = require('../../metro.shared.cjs');
    const path = require('node:path');
    const projectRoot = path.resolve(__dirname, '..');
    const result = createSharedMetroConfig({
      projectRoot,
      primaryNodeModules: path.join(projectRoot, 'node_modules'),
      secondaryNodeModules: path.join(projectRoot, '..', 'node_modules'),
      watchFolders: [],
      blockedPaths: [],
    });

    expect(fakeWrap).toHaveBeenCalledTimes(1);
    expect((result as { __sentryWrapped?: boolean }).__sentryWrapped).toBe(true);
  });

  it('falls back to the bare config when @sentry/react-native/metro is missing', () => {
    delete process.env.EXPO_NO_SENTRY_METRO;
    delete process.env.SENTRY_ENABLE_METRO;
    delete process.env.EAS_BUILD;
    jest.resetModules();
    jest.doMock('@sentry/react-native/metro', () => {
      throw new Error('not installed');
    });

    const { createSharedMetroConfig } = require('../../metro.shared.cjs');
    const path = require('node:path');
    const projectRoot = path.resolve(__dirname, '..');
    const result = createSharedMetroConfig({
      projectRoot,
      primaryNodeModules: path.join(projectRoot, 'node_modules'),
      secondaryNodeModules: path.join(projectRoot, '..', 'node_modules'),
      watchFolders: [],
      blockedPaths: [],
    });

    // Should still be a valid Metro config — resolver hook installed,
    // watchFolders populated.
    expect(typeof result.resolver.resolveRequest).toBe('function');
    expect(Array.isArray(result.watchFolders)).toBe(true);
  });
});
