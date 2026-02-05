// Metro config to normalize dev-server request URLs on Windows-style paths.
// This keeps source map URLs clean for web devtools.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

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
