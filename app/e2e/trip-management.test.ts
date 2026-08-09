/**
 * E2E: Trip management — selecting, switching, and navigating trips
 *
 * Covers the trip list, active-trip selection, and basic multi-trip
 * switching behaviour.
 */
import { test, expect } from '@playwright/test';
import { loginAsNewUser, createTripViaWizard, openTab, measureMs } from './fixtures';

test.describe('Trip Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNewUser(page);
  });

  test('newly created trip appears in the trip picker', async ({ page }) => {
    const tripName = await createTripViaWizard(page);

    // Open the "Select a trip" modal from the hero card
    await page.getByTestId('home-hero-card').click();
    await page.waitForLoadState('networkidle');

    // The trip name should appear in the list (hero card also shows the
    // active trip's name, so scope to the modal to avoid a strict-mode
    // violation from matching both).
    await expect(page.getByTestId('home-trip-modal').getByText(tripName)).toBeVisible({ timeout: 8000 });
  });

  test('user can switch active trip', async ({ page }) => {
    const tripName1 = await createTripViaWizard(page, { tripName: `Trip Alpha ${Date.now()}` });
    const tripName2 = await createTripViaWizard(page, { tripName: `Trip Beta ${Date.now() + 1}` });

    // Trip 2 is active after being created — switch to Trip 1
    await page.getByTestId('home-hero-card').click();
    await page.waitForLoadState('networkidle');

    const elapsed = await measureMs(async () => {
      await page.getByText(tripName1).click();
      // Selecting a trip closes the picker modal.
      await expect(page.getByTestId('home-trip-modal')).not.toBeVisible({ timeout: 3000 });
    });

    expect(elapsed, `Trip switch took ${elapsed}ms — expected < 3000ms`).toBeLessThan(3000);

    // Reopen the picker and confirm Trip 1 (not Trip 2) is now marked Active.
    await page.getByTestId('home-hero-card').click();
    const row1 = page.locator('[data-testid^="home-trip-row-"]').filter({ hasText: tripName1 });
    const row2 = page.locator('[data-testid^="home-trip-row-"]').filter({ hasText: tripName2 });
    await expect(row1.getByText('Active', { exact: true })).toBeVisible();
    await expect(row2.getByText('Active', { exact: true })).not.toBeVisible();
  });

  test('all main tabs load without JavaScript errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await createTripViaWizard(page);

    // 'overview' navigates to its own standalone page (unlike the other tabs,
    // which stay within the home grid context) — test it last so it doesn't
    // strand subsequent home-nav-* clicks.
    const tabs: Array<[string, string]> = [
      ['flights', 'Transfers'],
      ['lodging', 'Lodging'],
      ['tours', 'Activities'],
      ['expenses', 'Daily Expenses'],
      ['cost', 'Cost Report'],
    ];

    for (const [tabKey, heading] of tabs) {
      await page.getByTestId(`home-nav-${tabKey}`).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(heading).first()).toBeVisible({ timeout: 5000 });
    }

    // Ledger is reached from within Cost Report, not the home nav grid.
    await page.getByText(/Ledger/).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Ledger', { exact: true }).first()).toBeVisible({ timeout: 5000 });

    // Return home before checking 'overview', which navigates to its own page.
    await page.getByText('⌂', { exact: true }).click();
    await page.getByTestId('home-nav-overview').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Overview').first()).toBeVisible({ timeout: 5000 });

    expect(jsErrors, `JS errors: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('overview tab shows trip name and participant section', async ({ page }) => {
    const tripName = await createTripViaWizard(page);

    await page.getByTestId('home-nav-overview').click();
    await page.waitForLoadState('networkidle');

    // Trip name should appear somewhere in overview
    await expect(page.getByText(tripName)).toBeVisible({ timeout: 8000 });

    // The Travelers/participants section is only shown in edit mode.
    await page.getByText('Edit', { exact: true }).click();
    await expect(
      page.getByText(/participant|member|traveler|group/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('hero card prompts trip creation when no trips exist yet', async ({ page }) => {
    // No trip has been created in this test (beforeEach only logs in), so the
    // hero card should offer to create one rather than show a trip picker.
    await page.getByTestId('home-hero-card').click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('home-no-trips-dialog')).toBeVisible({ timeout: 5000 });
  });
});
