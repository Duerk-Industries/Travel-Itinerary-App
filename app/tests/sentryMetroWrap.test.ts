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
describe('Sentry Metro integration', () => {
  it('wraps the shared config when @sentry/react-native/metro is installed', () => {
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
});
