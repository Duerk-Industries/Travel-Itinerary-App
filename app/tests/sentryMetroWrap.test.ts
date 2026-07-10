/**
 * @jest-environment node
 *
 * Locks in that metro.shared.cjs wraps the built config with
 * @sentry/react-native/metro's withSentryConfig — that's what injects
 * the Debug ID into every bundle so uploaded source maps can be matched
 * to a release at runtime even when no explicit release string is set.
 *
 * Without this wrap, EAS Build still produces an uploadable bundle but
 * symbolication on Sentry's side becomes brittle / silently broken.
 */
/// <reference types="jest" />
/// <reference types="node" />
describe('Sentry Metro integration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('wraps the shared config when @sentry/react-native/metro is installed', () => {
    delete process.env.EAS_BUILD;
    delete process.env.EXPO_NO_SENTRY_METRO;
    delete process.env.SENTRY_ENABLE_METRO;
    const calls: unknown[] = [];
    const fakeWrap = jest.fn((cfg: unknown, opts: unknown) => {
      calls.push({ cfg, opts });
      return { ...(cfg as object), __sentryWrapped: true };
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
      sentryWithMetroConfig: fakeWrap,
    });

    expect(fakeWrap).toHaveBeenCalledTimes(1);
    expect((result as { __sentryWrapped?: boolean }).__sentryWrapped).toBe(true);
    // Confirm we pass the options we expect — keeping the web bundle lean
    // (no replay) and avoiding the per-component annotation babel work.
    expect(calls[0]).toMatchObject({
      opts: { includeWebReplay: false, annotateReactComponents: false },
    });
  });

  it('falls back to the bare config when @sentry/react-native/metro is missing', () => {
    const { createSharedMetroConfig } = require('../../metro.shared.cjs');
    const path = require('node:path');
    const projectRoot = path.resolve(__dirname, '..');
    const result = createSharedMetroConfig({
      projectRoot,
      primaryNodeModules: path.join(projectRoot, 'node_modules'),
      secondaryNodeModules: path.join(projectRoot, '..', 'node_modules'),
      watchFolders: [],
      blockedPaths: [],
      sentryWithMetroConfig: null,
    });

    // Should still be a valid Metro config — resolver hook installed,
    // watchFolders populated.
    expect(typeof result.resolver.resolveRequest).toBe('function');
    expect(Array.isArray(result.watchFolders)).toBe(true);
  });

  describe('shouldUseSentryMetro EAS-build gating', () => {
    const { shouldUseSentryMetro } = require('../../metro.shared.cjs');

    it('is enabled by default (local dev, no EAS_BUILD)', () => {
      delete process.env.EAS_BUILD;
      delete process.env.EXPO_NO_SENTRY_METRO;
      delete process.env.SENTRY_ENABLE_METRO;
      expect(shouldUseSentryMetro()).toBe(true);
    });

    it('is disabled during EAS builds to avoid the 7.2.0 Metro serializer crash', () => {
      delete process.env.EXPO_NO_SENTRY_METRO;
      delete process.env.SENTRY_ENABLE_METRO;
      process.env.EAS_BUILD = 'true';
      expect(shouldUseSentryMetro()).toBe(false);

      process.env.EAS_BUILD = '1';
      expect(shouldUseSentryMetro()).toBe(false);
    });

    it('EXPO_NO_SENTRY_METRO=1 forces it off even outside an EAS build', () => {
      delete process.env.EAS_BUILD;
      delete process.env.SENTRY_ENABLE_METRO;
      process.env.EXPO_NO_SENTRY_METRO = '1';
      expect(shouldUseSentryMetro()).toBe(false);
    });

    it('SENTRY_ENABLE_METRO=1 forces it on even during an EAS build', () => {
      process.env.EAS_BUILD = 'true';
      delete process.env.EXPO_NO_SENTRY_METRO;
      process.env.SENTRY_ENABLE_METRO = '1';
      expect(shouldUseSentryMetro()).toBe(true);
    });

    it('actually skips wrapping the config during a simulated EAS build', () => {
      process.env.EAS_BUILD = 'true';
      delete process.env.EXPO_NO_SENTRY_METRO;
      delete process.env.SENTRY_ENABLE_METRO;

      const fakeWrap = jest.fn((cfg: unknown) => ({ ...(cfg as object), __sentryWrapped: true }));
      const { createSharedMetroConfig } = require('../../metro.shared.cjs');
      const path = require('node:path');
      const projectRoot = path.resolve(__dirname, '..');
      const result = createSharedMetroConfig({
        projectRoot,
        primaryNodeModules: path.join(projectRoot, 'node_modules'),
        secondaryNodeModules: path.join(projectRoot, '..', 'node_modules'),
        watchFolders: [],
        blockedPaths: [],
        sentryWithMetroConfig: fakeWrap,
      });

      expect(fakeWrap).not.toHaveBeenCalled();
      expect((result as { __sentryWrapped?: boolean }).__sentryWrapped).toBeUndefined();
    });
  });
});
