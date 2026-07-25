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
const workspacePackages = path.join(workspaceRoot, 'packages');
const escapedWorkspaceRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = createSharedMetroConfig({
  projectRoot,
  primaryNodeModules: projectNodeModules,
  secondaryNodeModules: workspaceNodeModules,
  // Watch only the workspace packages app/ imports from (packages/messaging
  // and packages/domain). Watching the entire workspaceRoot caused Metro's
  // file watcher to crawl server/, functions/, .firebase-data/ and root
  // scripts/assets on every change — blockList suppresses resolution but
  // not the crawl, so HMR latency suffered.
  watchFolders: [workspacePackages],
  blockedPaths: [
    new RegExp(`${escapedWorkspaceRoot}[\\\\/]server[\\\\/].*`),
    new RegExp(`${escapedWorkspaceRoot}[\\\\/]functions[\\\\/].*`),
    new RegExp(`${escapedWorkspaceRoot}[\\\\/]\\.firebase-data[\\\\/].*`),
  ],
});

// Local-dev only: serve the React DevTools installHook source map when the
// browser asks for it. (Chrome DevTools probes /installHook.js.map and logs
// a 404 in console otherwise; harmless but noisy.)
const installHookMapPath = path.join(__dirname, 'installHook.js.map');
const existingEnhanceMiddleware = config.server?.enhanceMiddleware;

config.server = {
  ...(config.server || {}),
  ...(process.env.WANDERBUNNIES_WEB_DEV === '1'
    ? { unstable_serverRoot: workspaceRoot }
    : {}),
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
