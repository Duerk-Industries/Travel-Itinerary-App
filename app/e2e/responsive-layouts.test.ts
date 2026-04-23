/**
 * E2E: Responsive layout — Priority 8
 *
 * Verifies that screens which were converted to a desktop/table vs.
 * mobile/card responsive layout render the correct branch at each viewport.
 *
 * The breakpoint in the app is `width < 700 === narrow`, matching
 * `createTripWizard`, `overview`, `ledger`, and `dailyExpenses`.
 */
import { test, expect } from '@playwright/test';
import { loginAsNewUser, createTripViaWizard, openTab } from './fixtures';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

test.describe('Responsive layouts', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsNewUser(page);
    await createTripViaWizard(page);
  });

  test('daily expenses shows the wide-grid table at desktop width', async ({ page }) => {
    await openTab(page, 'expenses');
    await expect(page.getByText('Daily Expenses').first()).toBeVisible();

    await expect(page.getByTestId('daily-expenses-table')).toBeVisible();
    await expect(page.getByTestId('daily-expenses-cards')).toHaveCount(0);
  });

  test('daily expenses switches to day cards at phone width', async ({ page }) => {
    await openTab(page, 'expenses');
    await expect(page.getByText('Daily Expenses').first()).toBeVisible();
    await expect(page.getByTestId('daily-expenses-table')).toBeVisible();

    await page.setViewportSize(PHONE);

    await expect(page.getByTestId('daily-expenses-cards')).toBeVisible();
    await expect(page.getByTestId('daily-expenses-table')).toHaveCount(0);
  });

  test('ledger shows the desktop table at desktop width and cards at phone width', async ({ page }) => {
    await openTab(page, 'ledger');
    await expect(page.getByTestId('ledger-table')).toBeVisible();
    await expect(page.getByTestId('ledger-cards')).toHaveCount(0);

    await page.setViewportSize(PHONE);

    await expect(page.getByTestId('ledger-cards')).toBeVisible();
    await expect(page.getByTestId('ledger-table')).toHaveCount(0);
  });
});
