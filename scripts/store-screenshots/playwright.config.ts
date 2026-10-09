import base from '../../playwright.config';
import { defineConfig } from '@playwright/test';

// Reuses the E2E server setup (in-memory DB) but runs only the store-screenshot spec.
export default defineConfig({
  ...base,
  testDir: '.',
  // All capture specs by default (frame.spec.ts has its own config); SPEC=<file> runs one.
  testMatch: process.env.SPEC ?? /(expenses|itinerary-blog)\.spec\.ts$/,
  reporter: 'list',
  fullyParallel: false,
  workers: 1,
  timeout: 300 * 1000,
  projects: [{ name: 'phone', use: {} }],
  webServer: (base.webServer as any[]).map((s) => ({ ...s, cwd: '../..', reuseExistingServer: false })),
});
