/**
 * Regression test for the iOS crash where socket.io-client's eager top-level
 * imports pulled in Node-only modules (`xmlhttprequest-ssl`, `ws`,
 * `child_process`) via engine.io-client's `*.node.js` transport files, causing
 * the entire `App.tsx` import graph to fail to evaluate on Hermes.
 *
 * The Metro config now aliases engine.io-client's `.node.js` files to their
 * browser equivalents on native platforms (see metro.config.cjs). Even on web
 * those imports must be safe to load, and our `getSocket()` / `connectSocket()`
 * wrappers must not throw at import time.
 *
 * This test guards against re-introducing eager Node-only imports into the
 * socket utility module.
 */

describe('socket module load safety', () => {
  it('imports utils/socket without throwing', () => {
    expect(() => {
      jest.isolateModules(() => {
        require('../utils/socket');
      });
    }).not.toThrow();
  });

  it('exposes the public surface used by App.tsx and the context providers', () => {
    jest.isolateModules(() => {
      const mod = require('../utils/socket');
      expect(typeof mod.getSocket).toBe('function');
      expect(typeof mod.connectSocket).toBe('function');
      expect(typeof mod.disconnectSocket).toBe('function');
      expect(typeof mod.resolveSocketServerUrl).toBe('function');
      expect(typeof mod.resolveSocketTransports).toBe('function');
    });
  });

  it('connectSocket / disconnectSocket swallow transport errors rather than throwing', () => {
    jest.isolateModules(() => {
      const mod = require('../utils/socket');
      expect(() => mod.connectSocket('test-token')).not.toThrow();
      expect(() => mod.disconnectSocket()).not.toThrow();
    });
  });

  it('AppRoot exposes a React component via both module.exports and .default', () => {
    // Mirrors the resolver chain used by app/AppEntry.js's `resolveComponentExport`.
    // Stub `./App` so we don't pull the full App.tsx import graph into the test.
    jest.isolateModules(() => {
      jest.doMock('../App', () => ({ __esModule: true, default: () => null }), { virtual: false });
      const appRootModule = require('../AppRoot');
      const resolved =
        typeof appRootModule === 'function'
          ? appRootModule
          : appRootModule && typeof appRootModule.default === 'function'
            ? appRootModule.default
            : null;
      expect(typeof resolved).toBe('function');
      // The AppEntry diagnostic relies on `default` being present whichever
      // form Metro's CJS/ESM interop hands us.
      expect(typeof (appRootModule as { default?: unknown }).default).toBe('function');
    });
  });
});
