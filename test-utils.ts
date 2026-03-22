/**
 * This file can be used to store utility functions that are shared across your tests.
 */
import { Page, expect } from '@playwright/test';

type StoredSession = {
  token: string;
  name: string;
  email?: string;
  role?: 'user' | 'admin';
  page?: string;
  pageHistory?: string[];
  tripId?: string | null;
  expiresAt: number;
};

/**
 * A function to handle user creation and login for tests.
 * It registers a new user via the API, then logs them in via the UI
 * to establish a valid browser session for the test.
 *
 * @param page The Playwright page object.
 */
export async function loginAsNewUser(page: Page): Promise<void> {
  // Generate a unique username for each test run to ensure isolation
  const randomId = Date.now();
  const email = `testuser_${randomId}@example.com`;
  // Use a standard password for tests
  const password = 'password123';
  const firstName = 'Test';
  const lastName = `User_${randomId}`;

  // The API URL is taken from your playwright.config.ts webServer setup
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
  const registerPath = process.env.API_REGISTER_PATH || '/api/web-auth/register';

  // --- 1. Register a new user ---
  const registrationBody = {
    email,
    password,
    passwordConfirm: password,
    firstName,
    lastName,
  };

  const registerResponse = await page.request.post(`${apiBaseUrl}${registerPath}`, {
    data: registrationBody,
  });

  if (!registerResponse.ok()) {
    const errorBody = await registerResponse.text();
    throw new Error(
      `Failed to register test user. Status: ${registerResponse.status()} ${registerResponse.statusText()}. URL: ${registerResponse.url()}. Body: ${errorBody}`
    );
  }

  // --- 2. Bootstrap a valid web session directly ---
  const oauthResponse = await page.request.post(`${apiBaseUrl}/api/auth/oauth`, {
    data: { email, provider: 'google' },
  });
  if (!oauthResponse.ok()) {
    const errorBody = await oauthResponse.text();
    throw new Error(
      `Failed to bootstrap auth session. Status: ${oauthResponse.status()} ${oauthResponse.statusText()}. URL: ${oauthResponse.url()}. Body: ${errorBody}`
    );
  }
  const oauthData = await oauthResponse.json();
  const session: StoredSession = {
    token: String(oauthData.token),
    name: `${firstName} ${lastName}`.trim() || email,
    email,
    role: oauthData.user?.role === 'admin' ? 'admin' : 'user',
    page: 'home',
    pageHistory: [],
    tripId: null,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };
  await page.addInitScript((payload) => {
    window.localStorage.setItem('stp.session', JSON.stringify(payload));
  }, session);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });

  // --- 3. Verify that auth bootstrap was successful ---
  await expect(page.getByTestId('home-nav-trips')).toBeVisible({ timeout: 15000 });
}

export const TEST_USER_PASSWORD = 'password123';
