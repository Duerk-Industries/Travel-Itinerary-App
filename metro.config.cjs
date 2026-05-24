// Root EAS builds should use the same Metro behavior as the app workspace.
const config = require('./app/metro.config.js');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;

// Prevent Metro from scanning Firebase Functions dependencies. Those installs can
// contain symlink/bin layouts that fail lstat on Windows-hosted runs.
config.resolver = {
  ...config.resolver,
  // `exclusionList` already includes Metro's defaults (for example `__tests__`).
  // Avoid re-wrapping an existing blockList RegExp, which can break on Windows.
  blockList: exclusionList([/functions\/node_modules\/.*/]),
};

config.server = {
  ...config.server,
  rewriteRequestUrl: (url) => {
    let next = url;
    // Normalize encoded or literal backslashes (Windows paths) to forward slashes.
    next = next.replace(/%5C/gi, '/').replace(/\\/g, '/');
    // Remove /../ segments that can show up in source map URLs.
    next = next.replace(/\/\.\.(?=\/)/g, '');
    // Collapse duplicate slashes in the path.
    next = next.replace(/\/{2,}/g, '/');
    return next;
  },
};

module.exports = config;
