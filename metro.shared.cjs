/**
 * Shared Metro config builder. Used by:
 *   - metro.config.cjs (workspace root — for EAS builds)
 *   - app/metro.config.js (app/ root — for local `expo start`)
 *
 * Keeping the resolver tweaks in one place prevents the two configs from
 * drifting, which previously caused deploy-only bugs (e.g. the
 * "Unimplemented component: <RNCSafeAreaProvider>" failure from a flat
 * resolverMainFields override).
 *
 * Anything platform/host-specific (which dev middleware to install, where
 * pdfjs-dist physically lives) is passed in by the caller; the resolver
 * shape itself is shared.
 */
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Loads @sentry/react-native's Metro wrapper if the package is installed.
 * Kept lazy so a missing install (e.g. a fresh checkout before `npm
 * install`) doesn't break Metro startup — Sentry's wrapper only adds Debug
 * ID injection and stack-frame collapsing, both of which are no-ops at
 * runtime when SENTRY_AUTH_TOKEN / EXPO_PUBLIC_SENTRY_DSN aren't set.
 */
const loadSentryWithMetroConfig = () => {
  try {
    return require('@sentry/react-native/metro').withSentryConfig;
  } catch {
    return null;
  }
};

const shouldUseSentryMetro = () => {
  if (process.env.EXPO_NO_SENTRY_METRO === '1') return false;
  if (process.env.SENTRY_ENABLE_METRO === '1') return true;

  // @sentry/react-native 7.2.0's Metro serializer can crash during EAS native
  // bundle embedding when Metro hands it an undefined bundle source while
  // extracting the Debug ID. Runtime Sentry still initializes from
  // EXPO_PUBLIC_SENTRY_DSN; this only disables the build-time Metro wrapper.
  const isEasBuild = process.env.EAS_BUILD === 'true' || process.env.EAS_BUILD === '1';
  return !isEasBuild;
};

/**
 * engine.io-client's package.json declares a `browser` field map that
 * substitutes its `*.node.js` transport files with browser equivalents.
 * Metro's subpath browser-field handling is unreliable, so we mirror the
 * map explicitly here for non-web platforms. Without this, iOS/Android
 * builds load `polling-xhr.node.js` -> `xmlhttprequest-ssl` ->
 * `require('fs')` at module evaluation, which throws on Hermes and
 * silently breaks the entire App.tsx import graph (manifesting as
 * "AppRoot module did not export a React component").
 */
const ENGINE_IO_NODE_STUBS = {
  './transports/polling-xhr.node.js': './transports/polling-xhr.js',
  './transports/websocket.node.js': './transports/websocket.js',
  './globals.node.js': './globals.js',
};

/**
 * @param {object} opts
 * @param {string} opts.projectRoot         Where Metro is rooted.
 * @param {string} opts.primaryNodeModules  First node_modules directory to consult.
 * @param {string} opts.secondaryNodeModules Fallback node_modules directory.
 * @param {string[]} opts.watchFolders      Extra folders to watch (e.g. workspace siblings).
 * @param {RegExp[]} [opts.blockedPaths]    Absolute-path regexes Metro should ignore.
 * @param {Function|null} [opts.sentryWithMetroConfig] Test/override seam for the optional Sentry wrapper.
 * @returns {import('metro-config').ConfigT}
 */
const createSharedMetroConfig = ({
  projectRoot,
  primaryNodeModules,
  secondaryNodeModules,
  watchFolders = [],
  blockedPaths = [],
  sentryWithMetroConfig,
}) => {
  const config = getDefaultConfig(projectRoot);
  const { resolver } = config;

  const customResolveRequest = (context, moduleName, platform) => {
    if (
      platform !== 'web' &&
      ENGINE_IO_NODE_STUBS[moduleName] &&
      context.originModulePath &&
      context.originModulePath.includes('engine.io-client')
    ) {
      return context.resolveRequest(context, ENGINE_IO_NODE_STUBS[moduleName], platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };

  config.resolver = {
    ...resolver,
    // Intentionally do NOT override `resolverMainFields`. Expo's
    // getDefaultConfig returns platform-aware defaults (web →
    // browser/module/main; native → react-native/browser/main). Forcing a
    // single static order broke web by pulling
    // react-native-safe-area-context's native `src/index.tsx` into the web
    // bundle, producing "Unimplemented component: <RNCSafeAreaProvider>".
    nodeModulesPaths: [primaryNodeModules, secondaryNodeModules],
    disableHierarchicalLookup: false,
    ...(blockedPaths.length > 0 ? { blockList: blockedPaths } : {}),
    resolveRequest: customResolveRequest,
  };

  config.watchFolders = Array.from(
    new Set([...(config.watchFolders || []), projectRoot, ...watchFolders]),
  );

  // Wrap with Sentry last so it observes the fully-built resolver/transformer
  // shape. The wrapper:
  //  - injects a Debug ID into each bundle + source map (so uploaded source
  //    maps match the running JS even when the release is unset),
  //  - collapses Sentry's own frames from LogBox stack traces.
  // Source-map UPLOAD happens later, during EAS build / `expo export` —
  // gated by SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT being present in
  // the build environment. None of that runs in dev unless you set it up.
  const withSentryConfig =
    sentryWithMetroConfig === undefined
      ? loadSentryWithMetroConfig()
      : sentryWithMetroConfig;
  if (withSentryConfig && shouldUseSentryMetro()) {
    return withSentryConfig(config, {
      // We don't ship session replay; opt out to keep the web bundle smaller.
      includeWebReplay: false,
      // Don't annotate every React component — extra babel work for no
      // diagnostic win unless we wire up Sentry's Performance product.
      annotateReactComponents: false,
    });
  }
  return config;
};

module.exports = {
  createSharedMetroConfig,
  ENGINE_IO_NODE_STUBS,
  shouldUseSentryMetro,
};
