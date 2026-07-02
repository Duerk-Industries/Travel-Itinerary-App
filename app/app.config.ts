import type { ExpoConfig } from 'expo/config';

// Shared with the repository-root app.config.js so `eas build` gets the same
// app identity whether it is launched from app/ or from the workspace root.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createExpoConfig } = require('../expo.config.shared.cjs') as {
  createExpoConfig: (options: { appDir: string; assetPrefix?: string }) => ExpoConfig;
};

const config: ExpoConfig = createExpoConfig({
  appDir: __dirname,
  assetPrefix: './',
});

export default config;
