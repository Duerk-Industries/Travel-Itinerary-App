/**
 * E2E: Authentication flows
 *
 * Covers registration, login, invalid-credential handling, and session
 * persistence. These tests do NOT require an active trip.
 */
import { test, expect } from '@playwright/test';
import { API_BASE, TEST_USER_PASSWORD, loginAsNewUser, registerUser, loginAsUser } from './fixtures';

test.describe('Authentication', () => {
  test('registers and logs in a new user within performance threshold', async ({ page }) => {
    // Measure total time from navigation to home screen
    const t0 = Date.now();
    await loginAsNewUser(page);
    const elapsed = Date.now() - t0;

    // Google RAIL load threshold for a web app: good < 5 s
    expect(elapsed, `Login took ${elapsed}ms — expected < 5000ms`).toBeLessThan(5000);

    // Session token must be in localStorage
    const token = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        const val = localStorage.getItem(key) ?? '';
        if (val.startsWith('eyJ')) return val; // JWT prefix
      }
      return null;
    });
    expect(token).not.toBeNull();
  });

  test('shows an error on incorrect password', async ({ page }) => {
    const creds = await registerUser(page.request);

    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByPlaceholder('Email').fill(creds.email);
    await page.getByPlaceholder('Password').fill('wrong-password-xyz');
    await page.getByText('Login').last().click();

    // Error feedback should appear — look for any text that signals failure
    await expect(
      page.getByText(/invalid|incorrect|wrong|failed|unauthorized/i).first(),
    ).toBeVisible({ timeout: 5000 });

    // Must NOT have navigated to the home screen
    await expect(page.getByTestId('home-nav-overview')).not.toBeVisible();
  });

  test('session persists across a page reload', async ({ page }) => {
    await loginAsNewUser(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Home screen must still be visible without re-login
    await expect(page.getByTestId('home-nav-overview')).toBeVisible({ timeout: 10_000 });
  });

  test('logout clears session and returns to login screen', async ({ page }) => {
    await loginAsNewUser(page);

    // Logout is exposed from the persistent top bar on authenticated screens.
    await page.getByTestId('topbar-logout').click();

    // After logout the login form must be visible
    await expect(page.getByPlaceholder('Email')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('home-nav-overview')).not.toBeVisible();
  });
});
