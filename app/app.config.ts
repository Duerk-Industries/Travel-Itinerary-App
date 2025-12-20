import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Shared Trip Planner',
  slug: 'shared-trip-planner',
  scheme: 'sharedtripplanner',
  web: {
    bundler: 'metro'
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.example.sharedtripplanner'
  },
  android: {
    package: 'com.example.sharedtripplanner'
  },
  extra: {
    backendUrl: process.env.BACKEND_URL || 'http://localhost:4000'
  }
};

export default config;
