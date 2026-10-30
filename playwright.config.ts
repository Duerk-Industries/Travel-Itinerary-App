import { defineConfig, devices } from '@playwright/test';

/**
 * Database backend selection for E2E tests.
 *
 * DB_BACKEND=memory   (default) — uses pg-mem in-process, no external deps required
 * DB_BACKEND=firebase           — uses Firestore emulator; requires `firebase emulators:start --only firestore`
 * DB_BACKEND=postgres           — uses a real PostgreSQL instance; requires DATABASE_URL env var
 *
 * See https://playwright.dev/docs/test-configuration.
 */
const dbBackend = (process.env.DB_BACKEND ?? 'memory') as 'memory' | 'firebase' | 'postgres';
const apiPort = process.env.E2E_API_PORT ?? '4011';
const webPort = process.env.E2E_WEB_PORT ?? '4173';
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
// Test workers and server startup use the same isolated endpoint.
process.env.API_BASE_URL = apiUrl;
const reuseServers = process.env.E2E_REUSE_SERVERS === '1' && !process.env.CI;

const serverEnv: Record<string, string> = {
  PORT: apiPort,
  AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? 'e2e-test-secret',
  E2E_MODE: '1',
  ATTRACTIONS_STARTUP_SYNC: '0',
  WEB_URL: webUrl,
  K_SERVICE: '',
  AUTOCOMPLETE_PREWARM: '0',
  NOTIFICATION_OUTBOX_WORKER_ENABLED: '0',
  MAIL_ENABLED: '0',
};

if (dbBackend === 'firebase') {
  serverEnv.DB_PROVIDER = 'firebase';
  serverEnv.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? 'localhost:8080';
  serverEnv.FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID ?? 'travel-itinerary-app-483623';
} else if (dbBackend === 'postgres') {
  serverEnv.DB_PROVIDER = 'postgres';
  if (process.env.DATABASE_URL) {
    serverEnv.DATABASE_URL = process.env.DATABASE_URL;
  }
} else {
  // memory (default) — explicitly set DB_PROVIDER to prevent server/.env's DB_PROVIDER=firebase from winning
  serverEnv.DB_PROVIDER = 'memory';
  serverEnv.USE_IN_MEMORY_DB = '1';
  serverEnv.FIRESTORE_EMULATOR_HOST = '';
}

export default defineConfig({
  testDir: './app/e2e',
  globalSetup: './app/e2e/globalSetup.ts',
  timeout: 120 * 1000,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Avoid browser workers competing with Metro's cold compilation. */
  workers: process.env.CI ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: webUrl,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: 'npm --prefix server run dev',
      url: `${apiUrl}/api/healthz`,
      reuseExistingServer: reuseServers,
      timeout: 120 * 1000,
      env: serverEnv,
    },
    {
      command: `npm --prefix app run web -- --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: reuseServers,
      timeout: 120 * 1000,
      env: {
        E2E_MODE: '1',
        API_BASE_URL: apiUrl,
        BACKEND_URL: apiUrl,
        EXPO_PUBLIC_BACKEND_URL: apiUrl,
        CI: 'true',
        EXPO_NO_DOCTOR: '1',
        EXPO_NO_DOTENV: '1',
      },
    },
  ],
});
