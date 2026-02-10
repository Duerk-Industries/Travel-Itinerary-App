import { Platform } from 'react-native';
import Constants from 'expo-constants';

export const initializeAppCheck = async () => {
  if (Platform.OS === 'web') {
    // --- WEB IMPLEMENTATION (reCAPTCHA v3) ---
    try {
      // Dynamically import Firebase Web SDKs to avoid bundling errors on native
      const { initializeApp, getApp, getApps } = await import('firebase/app');
      const { initializeAppCheck: initAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');

      const extra =
        Constants.expoConfig?.extra ||
        (Constants as any)?.manifest?.extra ||
        (Constants as any)?.manifest2?.extra ||
        {};

      // Load configuration from environment variables (local .env) or Expo config
      const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || extra.firebaseApiKey;
      const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || extra.firebaseAuthDomain;
      const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || extra.firebaseProjectId;
      const storageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || extra.firebaseStorageBucket;
      const messagingSenderId = process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || extra.firebaseMessagingSenderId;
      const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || extra.firebaseAppId;
      const recaptchaSiteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY || process.env.RECAPTCHA_SITE_KEY || extra.recaptchaSiteKey;

      if (!apiKey || !authDomain || !projectId || !appId || !recaptchaSiteKey) {
        console.error('Firebase App Check: Missing required configuration. Please set FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID, and RECAPTCHA_SITE_KEY in your .env file or app.json.');
      }

      const firebaseConfig = {
        apiKey: apiKey || '',
        authDomain: authDomain || '',
        projectId: projectId || '',
        storageBucket: storageBucket || '',
        messagingSenderId: messagingSenderId || '',
        appId: appId || ''
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
        provider: new ReCaptchaV3Provider(recaptchaSiteKey || ''),
        isTokenAutoRefreshEnabled: true,
      });

      console.log('Firebase App Check (Web) initialized.');
    } catch (error) {
      console.error('Failed to initialize Web App Check:', error);
    }

  } else {
    // --- NATIVE IMPLEMENTATION (Play Integrity / DeviceCheck) ---
    try {
      // Dynamically import native module
      const { firebase } = require('@react-native-firebase/app-check');
      
      const appCheck = firebase.appCheck();
      const provider = appCheck.newReactNativeFirebaseAppCheckProvider();

      provider.configure({
        android: {
          provider: 'playIntegrity',
          debug: __DEV__, // Uses debug token in development
        },
        apple: {
          provider: 'appAttestWithDeviceCheckFallback',
          debug: __DEV__, // Uses debug token in development
        },
      });

      await appCheck.initializeAppCheck({
        provider: provider,
        isTokenAutoRefreshEnabled: true,
      });
      
      console.log('Firebase App Check (Native) initialized.');
    } catch (error) {
      console.error('Failed to initialize Native App Check:', error);
    }
  }
};
