import path from 'path';
import dotenv from 'dotenv';
import { ExpoConfig } from 'expo/config';

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });
dotenv.config({ path: path.join(__dirname, '..', 'server', '.env'), override: true });
dotenv.config({ path: path.join(__dirname, '..', 'server', '.local_env'), override: true });
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

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
  version: '0.1.0',
  scheme: 'travelitineraryplanner',
  owner: 'duerk-industries',
  icon: './assets/wanderbunnies-app-icon.png',
  platforms: ['ios', 'android', 'web'],
  userInterfaceStyle: 'automatic',
  web: {
    bundler: 'metro',
    favicon: './assets/wanderbunnies-app-icon.png',
  },
  splash: {
    image: './assets/wanderbunnies-splash-screen.png',
    resizeMode: 'contain',
    backgroundColor: '#0b3c79',
  },
  ios: (() => {
    // Only dev builds get the blanket NSAllowsArbitraryLoads escape hatch (so
    // a physical device can reach any LAN dev host). Production builds get a
    // narrow loopback exception so HTTP to localhost still works in simulator
    // dev clients without opening up plaintext to everything else.
    const isProduction = process.env.NODE_ENV === 'production';
    return {
      supportsTablet: true,
      bundleIdentifier: 'com.duerkindustries.travelitineraryplanner',
      buildNumber: '1',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSAppTransportSecurity: {
          ...(isProduction ? {} : { NSAllowsArbitraryLoads: true }),
          NSExceptionDomains: {
            localhost: {
              NSIncludesSubdomains: true,
              NSExceptionAllowsInsecureHTTPLoads: true,
            },
          },
        },
      },
    };
  })(),
  android: {
    // Android appId must avoid hyphens; use a dot/alpha-only identifier.
    package: 'com.duerkindustries.travelitineraryplanner',
    versionCode: 1,
    // Android 15 (API 35) targets edge-to-edge by default; opt in explicitly so
    // the system bars don't overlap our SafeAreaView-wrapped content.
    edgeToEdgeEnabled: true,
    softwareKeyboardLayoutMode: 'pan',
    adaptiveIcon: {
      foregroundImage: './assets/wanderbunnies-android-foreground.png',
      backgroundColor: '#0b3c79',
      monochromeImage: './assets/wanderbunnies-android-monochrome.png',
    },
  },
  plugins: ['expo-web-browser'],
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
