import { Platform } from 'react-native';
import Constants from 'expo-constants';

declare const __DEV__: boolean;

let appCheckInitialization: Promise<void> | null = null;
let appCheckInitialized = false;

const APP_CHECK_INITIALIZED_KEY = '__travelItineraryAppCheckInitialized';
const getAppCheckGlobals = () => globalThis as Record<string, unknown>;

export const initializeAppCheck = async () => {
  const globals = getAppCheckGlobals();
  if (appCheckInitialized || globals[APP_CHECK_INITIALIZED_KEY] === true) return;
  if (appCheckInitialization) return appCheckInitialization;

  appCheckInitialization = initializeAppCheckOnce().finally(() => {
    appCheckInitialization = null;
  });
  return appCheckInitialization;
};

const initializeAppCheckOnce = async () => {
  if (Platform.OS === 'web') {
    // --- WEB IMPLEMENTATION (reCAPTCHA v3) ---
    try {
      // Dynamically import Firebase Web SDKs to avoid bundling errors on native
      const { initializeApp, getApp, getApps } = await import('firebase/app');
      const { initializeAppCheck: initAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');

      // Constants.manifest and manifest2 were removed in expo-constants 14+
      // (SDK 49). expoConfig is the only supported surface in SDK 54.
      const extra = Constants.expoConfig?.extra ?? {};

      // Load configuration from environment variables (local .env) or Expo config
      const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || extra.firebaseApiKey;
      const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || extra.firebaseAuthDomain;
      const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || extra.firebaseProjectId;
      const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || extra.firebaseStorageBucket;
      const messagingSenderId = process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || extra.firebaseMessagingSenderId;
      const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || extra.firebaseAppId;
      const recaptchaSiteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY || process.env.RECAPTCHA_SITE_KEY || extra.recaptchaSiteKey;

      if (!apiKey || !authDomain || !projectId || !appId || !recaptchaSiteKey) {
        return;
      }

      const firebaseConfig = {
        apiKey,
        authDomain,
        projectId,
        storageBucket: storageBucket || '',
        messagingSenderId: messagingSenderId || '',
        appId
      };

      // Initialize Firebase Web App if not already initialized
      const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

      // Enable debug token for local development environment
      if (__DEV__) {
        // @ts-ignore
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = process.env.EXPO_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN || true;
      }

      // Initialize App Check
      // Set isTokenAutoRefreshEnabled to true so the SDK handles token rotation
      initAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });

      appCheckInitialized = true;
      getAppCheckGlobals()[APP_CHECK_INITIALIZED_KEY] = true;
    } catch {
      appCheckInitialized = false;
    }
  } else {
    // Native App Check is intentionally disabled for the Expo build. The app's
    // backend APIs remain usable on iOS/Android without pulling RNFirebase pods
    // into the native project.
    appCheckInitialized = true;
    getAppCheckGlobals()[APP_CHECK_INITIALIZED_KEY] = true;
  }
};
