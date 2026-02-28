const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const projectNodeModules = path.join(projectRoot, 'node_modules');
const workspaceNodeModules = path.join(workspaceRoot, 'node_modules');
const pdfjsDistPath = fs.existsSync(path.join(projectNodeModules, 'pdfjs-dist'))
  ? path.join(projectNodeModules, 'pdfjs-dist')
  : path.join(workspaceNodeModules, 'pdfjs-dist');

const config = getDefaultConfig(__dirname);
const { resolver } = config;

// Add support for svgs
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
    projectNodeModules,
    workspaceNodeModules,
  ],
  disableHierarchicalLookup: true,
};

const installHookMapPath = path.join(__dirname, 'installHook.js.map');
const existingEnhanceMiddleware = config.server?.enhanceMiddleware;

config.watchFolders = Array.from(
  new Set([...(config.watchFolders || []), projectRoot, workspaceRoot]),
);
config.watchFolders = Array.from(
  new Set([...(config.watchFolders || []), projectRoot, workspaceRoot]),
);

config.server = {
  ...(config.server || {}),
  enhanceMiddleware: (middleware) => {
    const baseMiddleware = existingEnhanceMiddleware
      ? existingEnhanceMiddleware(middleware)
      : middleware;

    return (req, res, next) => {
      if (req.url === '/installHook.js.map' && fs.existsSync(installHookMapPath)) {
        res.setHeader('Content-Type', 'application/json');
        res.end(fs.readFileSync(installHookMapPath, 'utf8'));
        return;
      }
      return baseMiddleware(req, res, next);
    };
  },
};

module.exports = config;
