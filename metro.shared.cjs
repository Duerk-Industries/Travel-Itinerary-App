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
 * @10play/tentap-editor's RichText/Toolbar wrap `react-native-webview`,
 * which has no web implementation. On web platform, swap it (and the
 * codegenNativeComponent machinery it needs) for @10play's iframe-based
 * shim, and swap Node's `crypto` for expo-crypto. Per the library's Expo
 * Web setup docs: https://10play.github.io/10tap-editor/docs/setup/expoWeb
 * Native platforms are untouched — they use the real WebView.
 */
const TENTAP_WEB_ALIASES = {
  'react-native-webview': '@10play/react-native-web-webview',
  'react-native/Libraries/Utilities/codegenNativeComponent': '@10play/react-native-web-webview/shim',
  crypto: 'expo-crypto',
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

  // getDefaultConfig() auto-detects the Yarn/npm workspace and points
  // server.unstable_serverRoot at the monorepo root instead of projectRoot.
  // That's harmless for `expo start` (module resolution goes through
  // resolver.nodeModulesPaths/watchFolders, not server.root), but it breaks
  // local Android release builds on Windows: the React Native Gradle
  // plugin's cliPath() converts --entry-file to a path relative to `root`
  // (app/) instead of absolute (an absolute-vs-relative branch that only
  // exists on Windows — macOS/Linux always pass absolute paths), and Metro
  // then resolves that relative path against server.unstable_serverRoot.
  // When the two roots disagree, entry-file resolution fails with
  // "Unable to resolve module ./AppEntry.js". Forcing serverRoot back to
  // projectRoot keeps both sides consistent.
  config.server = { ...config.server, unstable_serverRoot: projectRoot };

  const customResolveRequest = (context, moduleName, platform) => {
    if (
      platform !== 'web' &&
      ENGINE_IO_NODE_STUBS[moduleName] &&
      context.originModulePath &&
      context.originModulePath.includes('engine.io-client')
    ) {
      return context.resolveRequest(context, ENGINE_IO_NODE_STUBS[moduleName], platform);
    }
    if (platform === 'web' && TENTAP_WEB_ALIASES[moduleName]) {
      return {
        filePath: require.resolve(TENTAP_WEB_ALIASES[moduleName]),
        type: 'sourceFile',
      };
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
