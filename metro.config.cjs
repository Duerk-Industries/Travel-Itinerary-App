// Root Metro config for EAS builds. We build our own config from
// `expo/metro-config` rooted at the workspace, then layer on the same resolver
// tweaks that `app/metro.config.js` uses for local dev. This keeps
// `projectRoot` correct (the workspace, not `app/`) so expo-doctor's
// Metro-config check passes and bundling is rooted consistently.
const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;

const projectRoot = __dirname;
const appRoot = path.join(projectRoot, 'app');
const projectNodeModules = path.join(projectRoot, 'node_modules');
const appNodeModules = path.join(appRoot, 'node_modules');
const pdfjsDistPath = fs.existsSync(path.join(appNodeModules, 'pdfjs-dist'))
  ? path.join(appNodeModules, 'pdfjs-dist')
  : path.join(projectNodeModules, 'pdfjs-dist');

const config = getDefaultConfig(projectRoot);
const { resolver } = config;

// engine.io-client's package.json declares a `browser` field map that
// substitutes its `*.node.js` transport files with browser equivalents.
// Metro's subpath browser-field handling is unreliable, so we mirror that
// map explicitly here for non-web platforms. Without this, iOS/Android
// builds load `polling-xhr.node.js` -> `xmlhttprequest-ssl` -> `require('fs')`
// at module evaluation, which throws on Hermes and silently breaks the
// entire App.tsx import graph (manifesting as "AppRoot module did not
// export a React component").
const engineIoNodeStubs = {
  './transports/polling-xhr.node.js': './transports/polling-xhr.js',
  './transports/websocket.node.js': './transports/websocket.js',
  './globals.node.js': './globals.js',
};

const aliasEngineIoNodeFiles = (context, moduleName, platform) => {
  if (
    platform !== 'web' &&
    engineIoNodeStubs[moduleName] &&
    context.originModulePath &&
    context.originModulePath.includes('engine.io-client')
  ) {
    return context.resolveRequest(context, engineIoNodeStubs[moduleName], platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: resolver.sourceExts.includes('svg')
    ? resolver.sourceExts
    : [...resolver.sourceExts, 'svg'],
  resolverMainFields: [
    'react-native',
    'browser',
    'module',
    'main',
    ...((resolver.resolverMainFields || []).filter(
      (field) => !['react-native', 'browser', 'module', 'main'].includes(field),
    )),
  ],
  extraNodeModules: {
    ...(resolver.extraNodeModules || {}),
    'pdfjs-dist': pdfjsDistPath,
  },
  nodeModulesPaths: [
    appNodeModules,
    projectNodeModules,
  ],
  disableHierarchicalLookup: false,
  blockList: exclusionList([/functions\/node_modules\/.*/]),
  resolveRequest: aliasEngineIoNodeFiles,
};

config.watchFolders = Array.from(
  new Set([...(config.watchFolders || []), projectRoot, appRoot]),
);

config.server = {
  ...(config.server || {}),
  rewriteRequestUrl: (url) => {
    let next = url;
    next = next.replace(/%5C/gi, '/').replace(/\\/g, '/');
    next = next.replace(/\/\.\.(?=\/)/g, '');
    next = next.replace(/\/{2,}/g, '/');
    return next;
  },
};

module.exports = config;
