// Root Metro config for EAS builds. Builds on the shared resolver in
// `metro.shared.cjs` so this file and `app/metro.config.js` cannot drift.
// Keeps `projectRoot` at the workspace so expo-doctor's Metro-config check
// passes and bundling is rooted consistently.
const path = require('path');
const { createSharedMetroConfig } = require('./metro.shared.cjs');

const projectRoot = __dirname;
const appRoot = path.join(projectRoot, 'app');
const projectNodeModules = path.join(projectRoot, 'node_modules');
const appNodeModules = path.join(appRoot, 'node_modules');
const escapedProjectRoot = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const config = createSharedMetroConfig({
  projectRoot,
  primaryNodeModules: appNodeModules,
  secondaryNodeModules: projectNodeModules,
  watchFolders: [appRoot],
  // Metro accepts an array of RegExp directly for `resolver.blockList`; this
  // avoids depending on metro-config's private exclusionList helper (which
  // lives under `metro-config/private/` and is unstable across Metro
  // versions). We broadly exclude backend directories (server, functions)
  // and emulator data to keep the app bundle clean and the crawler fast.
  blockedPaths: [
    new RegExp(`${escapedProjectRoot}[\\\\/]server[\\\\/].*`),
    new RegExp(`${escapedProjectRoot}[\\\\/]functions[\\\\/].*`),
    new RegExp(`${escapedProjectRoot}[\\\\/]\\.firebase-data[\\\\/].*`),
  ],
});

// EAS builds may receive bundler URLs that contain Windows-style backslashes
// (from local mirrors) or `/..` segments. Normalize them before Metro tries
// to match a graph node.
config.server = {
  ...(config.server || {}),
  rewriteRequestUrl: (url) => {
    let next = url;
    next = next.replace(/%5C/gi, '/').replace(/\\/g, '/');
    next = next.replace(/\/\.\.(?=\/)/g, '');
    const protocolMatch = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/i.exec(next);
    if (protocolMatch) {
      return protocolMatch[1] + protocolMatch[2].replace(/\/{2,}/g, '/');
    }
    next = next.replace(/\/{2,}/g, '/');
    return next;
  },
};

module.exports = config;
