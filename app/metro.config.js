const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

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
};

const installHookMapPath = path.join(__dirname, 'installHook.js.map');
const existingEnhanceMiddleware = config.server?.enhanceMiddleware;

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
