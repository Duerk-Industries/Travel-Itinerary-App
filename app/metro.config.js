// App-rooted Metro config for `expo start` during local development.
// Shares its resolver behavior with the workspace-root metro.config.cjs via
// metro.shared.cjs so EAS builds and local dev cannot diverge.
const fs = require('fs');
const path = require('path');
const { createSharedMetroConfig } = require('../metro.shared.cjs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const projectNodeModules = path.join(projectRoot, 'node_modules');
const workspaceNodeModules = path.join(workspaceRoot, 'node_modules');

const config = createSharedMetroConfig({
  projectRoot,
  primaryNodeModules: projectNodeModules,
  secondaryNodeModules: workspaceNodeModules,
  watchFolders: [workspaceRoot],
  blockedPaths: [
    /server[\\/].*/,
    /functions[\\/].*/,
    /\.firebase-data[\\/].*/,
  ],
});

// Local-dev only: serve the React DevTools installHook source map when the
// browser asks for it. (Chrome DevTools probes /installHook.js.map and logs
// a 404 in console otherwise; harmless but noisy.)
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
