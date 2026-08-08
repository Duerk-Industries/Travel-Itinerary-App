const path = require('path');
const dotenv = require('dotenv');

const stripDotSlash = (value) => value.replace(/^\.\//, '');

const prefixAsset = (value, assetPrefix) => {
  if (!value) return value;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }
  return `${assetPrefix}${stripDotSlash(value)}`;
};

const resolvePluginFromApp = (moduleName, appDir) => {
  try {
    return require.resolve(moduleName, { paths: [appDir] });
  } catch {
    return moduleName;
  }
};

const loadEnv = (appDir) => {
  const workspaceRoot = path.resolve(appDir, '..');
  dotenv.config({ path: path.join(workspaceRoot, '.env'), override: true });
  dotenv.config({ path: path.join(workspaceRoot, 'server', '.env'), override: true });
  dotenv.config({ path: path.join(workspaceRoot, 'server', '.local_env'), override: true });
  dotenv.config({ path: path.join(appDir, '.env'), override: true });

  if (!process.env.EXPO_PUBLIC_BACKEND_URL) {
    // Avoid `process.env.X = undefined`, which Node coerces to the string
    // "undefined".
    const fallback =
      process.env.BACKEND_URL ??
      process.env.WEB_URL ??
      process.env.API_BASE_URL;
    if (fallback) {
      process.env.EXPO_PUBLIC_BACKEND_URL = fallback;
    }
  }

  // The phase-11 release pipeline builds one static web artifact and
  // promotes it unmodified from test to production (build-release.ps1/.sh),
  // so it must resolve the backend via same-origin `/api/**` (routed by
  // each environment's own Firebase Hosting rewrite) rather than a URL
  // baked in at build time. Local dev's app/.env sets
  // EXPO_PUBLIC_BACKEND_URL for convenience (e.g. pointing at prod data
  // while running `expo start --web` locally) and loads with
  // `override: true`, so it would otherwise clobber same-origin
  // resolution in every release build. RELEASE_WEB_BUILD is set only by
  // the release scripts to suppress that for this build.
  if (process.env.RELEASE_WEB_BUILD === '1') {
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
  }
};

const createExpoConfig = ({ appDir, assetPrefix = './' }) => {
  loadEnv(appDir);

  // True when this config is evaluated inside an EAS Build (cloud or `--local`).
  // EAS sets EAS_BUILD=true. A built artifact runs on a real device/simulator,
  // so it must never fall back to a localhost backend.
  const isEasBuild = process.env.EAS_BUILD === 'true' || process.env.EAS_BUILD === '1';
  const sentryExpoPlugin =
    assetPrefix === './app/'
      ? resolvePluginFromApp('@sentry/react-native/expo', appDir)
      : '@sentry/react-native/expo';

  return {
    name: 'WanderBunnies',
    slug: 'travel-itinerary-planner',
    version: '0.1.0',
    scheme: 'travelitineraryplanner',
    owner: 'duerk-industries',
    icon: prefixAsset('./assets/wanderbunnies-app-icon.png', assetPrefix),
    platforms: ['ios', 'android', 'web'],
    userInterfaceStyle: 'automatic',
    web: {
      bundler: 'metro',
      favicon: prefixAsset('./assets/wanderbunnies-app-icon.png', assetPrefix),
    },
    splash: {
      image: prefixAsset('./assets/wanderbunnies-splash-screen.png', assetPrefix),
      resizeMode: 'contain',
      backgroundColor: '#0b3c79',
    },
    ios: (() => {
      const easProfile = process.env.EAS_BUILD_PROFILE;
      const isDevLikeBuild =
        easProfile === 'development' ||
        (!isEasBuild && process.env.NODE_ENV !== 'production');
      const isProduction = !isDevLikeBuild;
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
      package: 'com.duerkindustries.travelitineraryplanner',
      versionCode: 1,
      edgeToEdgeEnabled: true,
      softwareKeyboardLayoutMode: 'pan',
      adaptiveIcon: {
        foregroundImage: prefixAsset('./assets/wanderbunnies-android-foreground.png', assetPrefix),
        backgroundColor: '#0b3c79',
        monochromeImage: prefixAsset('./assets/wanderbunnies-android-monochrome.png', assetPrefix),
      },
    },
    plugins: [
      'expo-web-browser',
      'expo-video',
      [
        'expo-image-picker',
        {
          photosPermission: 'WanderBunnies needs access to your photos so you can add them to a trip blog.',
        },
      ],
      [
        sentryExpoPlugin,
        {
          organization: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          url: process.env.SENTRY_URL ?? 'https://sentry.io/',
        },
      ],
    ],
    extra: {
      // A web release build (RELEASE_WEB_BUILD=1, set only by
      // build-release.ps1/.sh) must promote one artifact unmodified from
      // test to production, so it leaves backendUrl unset here rather than
      // defaulting to prod -- app/utils/backendUrl.ts already falls back to
      // same-origin (`window.location.origin`) in the browser when no
      // backend URL is configured, and each environment's own Firebase
      // Hosting rewrite routes `/api/**` to that environment's backend.
      // Native builds have no browser origin to fall back to, so they keep
      // defaulting to prod.
      backendUrl:
        process.env.RELEASE_WEB_BUILD === '1'
          ? undefined
          : process.env.EXPO_PUBLIC_BACKEND_URL ??
            process.env.BACKEND_URL ??
            process.env.WEB_URL ??
            process.env.API_BASE_URL ??
            process.env.REACT_APP_BACKEND_URL ??
            process.env.REACT_NATIVE_APP_BACKEND_URL ??
            (process.env.NODE_ENV === 'development' && !isEasBuild
              ? 'http://localhost:4000'
              : 'https://wander-bunnies.com'),
      refreshIntervalMs: Number(process.env.REFRESH_INTERVAL_MS) || 60000,
      sessionCacheTimeoutMinutes: Number(process.env.SESSION_CACHE_TIMEOUT_MINUTES) || 720,
      premiumTrialsEnabled: String(process.env.EXPO_PUBLIC_PREMIUM_TRIALS_ENABLED ?? 'true').toLowerCase() !== 'false',
      eas: {
        projectId: '06966c0b-d878-4346-850c-090c762f1916',
      },
    },
  };
};

module.exports = {
  createExpoConfig,
};
