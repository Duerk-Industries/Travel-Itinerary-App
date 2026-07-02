const path = require('path');
const { createExpoConfig } = require('./expo.config.shared.cjs');

module.exports = createExpoConfig({
  appDir: path.join(__dirname, 'app'),
  assetPrefix: './app/',
});
