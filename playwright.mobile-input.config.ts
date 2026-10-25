import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// These tests mock all API requests; a backend is intentionally unnecessary.
// An existing frontend can be used with MOBILE_INPUT_BASE_URL=http://localhost:8081.
export default defineConfig({
  ...base,
  testMatch: 'mobile-input-regressions.test.ts',
  use: { ...base.use, baseURL: process.env.MOBILE_INPUT_BASE_URL ?? 'http://127.0.0.1:4173', channel: process.env.MOBILE_INPUT_BROWSER_CHANNEL },
  webServer: process.env.MOBILE_INPUT_BASE_URL ? undefined : Array.isArray(base.webServer) ? base.webServer[1] : undefined,
});
