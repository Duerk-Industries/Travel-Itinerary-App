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
const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

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

const resolvePdfjsDist = (preferred, fallback) => {
  if (fs.existsSync(path.join(preferred, 'pdfjs-dist'))) {
    return path.join(preferred, 'pdfjs-dist');
  }
  return path.join(fallback, 'pdfjs-dist');
};

/**
 * @param {object} opts
 * @param {string} opts.projectRoot         Where Metro is rooted.
 * @param {string} opts.primaryNodeModules  First node_modules directory to consult.
 * @param {string} opts.secondaryNodeModules Fallback node_modules directory.
 * @param {string[]} opts.watchFolders      Extra folders to watch (e.g. workspace siblings).
 * @param {RegExp[]} [opts.blockedPaths]    Absolute-path regexes Metro should ignore.
 * @returns {import('metro-config').ConfigT}
 */
const createSharedMetroConfig = ({
  projectRoot,
  primaryNodeModules,
  secondaryNodeModules,
  watchFolders = [],
  blockedPaths = [],
}) => {
  const config = getDefaultConfig(projectRoot);
  const { resolver } = config;

  const pdfjsDistPath = resolvePdfjsDist(primaryNodeModules, secondaryNodeModules);

  // Combined resolveRequest: handles the engine.io-client native aliasing AND
  // the web-only pdfjs-dist alias. pdfjs-dist depends on Node/canvas APIs and
  // is only imported from .web.ts files; explicitly resolving it for web (and
  // failing fast on native) prevents accidental native imports from silently
  // bundling Node-shaped code.
  const customResolveRequest = (context, moduleName, platform) => {
    if (
      platform !== 'web' &&
      ENGINE_IO_NODE_STUBS[moduleName] &&
      context.originModulePath &&
      context.originModulePath.includes('engine.io-client')
    ) {
      return context.resolveRequest(context, ENGINE_IO_NODE_STUBS[moduleName], platform);
    }
    if (moduleName === 'pdfjs-dist' && platform === 'web') {
      return { type: 'sourceFile', filePath: require.resolve('pdfjs-dist') };
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
    extraNodeModules: {
      ...(resolver.extraNodeModules || {}),
      // Kept as a defensive fallback for tooling that resolves at config
      // time (typecheck, scripts). Runtime resolution on native is gated by
      // customResolveRequest above.
      'pdfjs-dist': pdfjsDistPath,
    },
    nodeModulesPaths: [primaryNodeModules, secondaryNodeModules],
    disableHierarchicalLookup: false,
    ...(blockedPaths.length > 0 ? { blockList: blockedPaths } : {}),
    resolveRequest: customResolveRequest,
  };

  config.watchFolders = Array.from(
    new Set([...(config.watchFolders || []), projectRoot, ...watchFolders]),
  );

  return config;
};

module.exports = {
  createSharedMetroConfig,
  ENGINE_IO_NODE_STUBS,
};
