import path from 'path';
import dotenv from 'dotenv';
import { ExpoConfig } from 'expo/config';

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });
dotenv.config({ path: path.join(__dirname, '..', 'server', '.env'), override: true });
dotenv.config({ path: path.join(__dirname, '..', 'server', '.local_env'), override: true });

if (!process.env.EXPO_PUBLIC_BACKEND_URL) {
  // Avoid `process.env.X = undefined`, which Node coerces to the string "undefined".
  const fallback =
    process.env.BACKEND_URL ??
    process.env.WEB_URL ??
    process.env.API_BASE_URL;
  if (fallback) {
    process.env.EXPO_PUBLIC_BACKEND_URL = fallback;
  }
}

const config: ExpoConfig = {
  name: 'WanderBunnies',
  slug: 'travel-itinerary-planner',
  scheme: 'travelitineraryplanner',
  owner: 'duerk-industries',
  icon: './assets/wanderbunnies-app-icon.png',
  platforms: ['ios', 'android', 'web'],
  web: {
    bundler: 'metro',
    favicon: './assets/wanderbunnies-app-icon.png',
  },
  splash: {
    image: './assets/wanderbunnies-splash-screen.png',
    resizeMode: 'contain',
    backgroundColor: '#0b3c79',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.duerkindustries.travelitineraryplanner',
    infoPlist: {
      "ITSAppUsesNonExemptEncryption": false,
      // Allow plain HTTP calls to the local backend while developing.
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
        NSExceptionDomains: {
          localhost: {
            NSIncludesSubdomains: true,
            NSExceptionAllowsInsecureHTTPLoads: true,
          },
        },
      },
    }
  },
  android: {
    // Android appId must avoid hyphens; use a dot/alpha-only identifier.
    package: 'com.duerkindustries.travelitineraryplanner'
  },
  extra: {
    backendUrl:
      process.env.EXPO_PUBLIC_BACKEND_URL ??
      process.env.BACKEND_URL ??
      process.env.WEB_URL ??
      process.env.API_BASE_URL ??
      process.env.REACT_APP_BACKEND_URL ??
      process.env.REACT_NATIVE_APP_BACKEND_URL ??
      (process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : 'https://duerk.org'),
    refreshIntervalMs: Number(process.env.REFRESH_INTERVAL_MS) || 60000,
    sessionCacheTimeoutMinutes: Number(process.env.SESSION_CACHE_TIMEOUT_MINUTES) || 720,
    eas: {
        projectId: "06966c0b-d878-4346-850c-090c762f1916"
    }
  }
};

export default config;
