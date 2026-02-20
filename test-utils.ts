/**
 * This file can be used to store utility functions that are shared across your tests.
 */
import { Page, expect } from '@playwright/test';

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
  const registerPath = process.env.API_REGISTER_PATH || '/api/auth/register';

  // --- 1. Register a new user ---
  const registrationBody = {
    username: `testuser_${randomId}`,
    password,
    email,
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

  // --- 2. Log in via the UI to establish a session ---
  // The baseURL comes from playwright.config.ts
  // We assume the login page is at '/login'
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 90_000 });

  // Fill in credentials and submit
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  // The login "button" is not a standard <button> element and lacks role="button",
  // so we must use a different locator. The page has two "Login" texts,
  // one in the header and one for the form. We can reliably select the form's
  // button by taking the last one.
  await page.getByText('Login').last().click();

  // --- 3. Verify that login was successful ---
  // Wait for a post-login element to be visible. The test that calls this
  // function immediately looks for a "Trips" button, so we'll wait for that.
  // This makes the helper function more robust.
  await expect(page.getByTestId('home-nav-trips')).toBeVisible({ timeout: 15000 });
}

export const TEST_USER_PASSWORD = 'password123';
