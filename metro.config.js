// Metro config to normalize dev-server request URLs on Windows-style paths.
// This keeps source map URLs clean for web devtools.
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;

const config = getDefaultConfig(__dirname);

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
