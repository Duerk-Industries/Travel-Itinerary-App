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

const serverEnv: Record<string, string> = {
  PORT: '3000',
  AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-test-secret',
  E2E_MODE: '1',
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
  // memory (default)
  serverEnv.DB_PROVIDER = 'memory';
  serverEnv.USE_IN_MEMORY_DB = '1';
}

export default defineConfig({
  testDir: './app/e2e',
  timeout: 120 * 1000,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Single worker on CI to share one server instance; unlimited locally */
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: 'npm --prefix server run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: serverEnv,
    },
    {
      command: 'npm --prefix app run web -- --port 4173',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: {
        BACKEND_URL: 'http://localhost:3000',
        EXPO_PUBLIC_BACKEND_URL: 'http://localhost:3000',
        CI: 'true',
      },
    },
  ],
});
