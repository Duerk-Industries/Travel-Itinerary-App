import { goHome } from './ui';
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

    // Open the current All Trips screen.
    await page.getByTestId('home-all-trips').click();


    // Scope the assertion to the upcoming-trip list.
    await expect(page.getByTestId('all-trips-upcoming').getByText(tripName)).toBeVisible({ timeout: 8000 });
  });

  test('user can switch active trip', async ({ page }) => {
    const tripName1 = await createTripViaWizard(page, { tripName: `Trip Alpha ${Date.now()}` });
    const tripName2 = await createTripViaWizard(page, { tripName: `Trip Beta ${Date.now() + 1}` });

    // Trip 2 is active after being created — switch to Trip 1
    await page.getByTestId('home-all-trips').click();


    const elapsed = await measureMs(async () => {
      await page.getByText(tripName1).click();
      // Selecting a trip returns to Home.
      await expect(page.getByRole('heading', { name: 'All Trips', exact: true })).not.toBeVisible({ timeout: 3000 });
    });

    expect(elapsed, `Trip switch took ${elapsed}ms — expected < 3000ms`).toBeLessThan(3000);

    // Reopen All Trips and confirm which trip is active.
    await page.getByTestId('home-all-trips').click();
    const row1 = page.locator('[data-testid^="all-trips-row-"]').filter({ hasText: tripName1 });
    const row2 = page.locator('[data-testid^="all-trips-row-"]').filter({ hasText: tripName2 });
    await expect(row1.getByText('Active', { exact: true })).toBeVisible();
    await expect(row2.getByText('Active', { exact: true })).toHaveCount(0);
  });

  test('all main tabs load without JavaScript errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await createTripViaWizard(page);

    // Exercise each current page through the shared navigation helper.
    const tabs: Array<[string, string]> = [
      ['flights', 'Flights'],
      ['lodging', 'Lodging'],
      ['tours', 'Activities'],
      ['expenses', 'Daily Expenses'],
      ['cost', 'Cost Report'],
    ];

    for (const [tabKey, heading] of tabs) {
      await openTab(page, tabKey);

      await expect(page.getByText(heading).first()).toBeVisible({ timeout: 5000 });
    }

    // Balances is reached from within Cost Report (the Settle Up button), not the home nav grid.
    await page.getByText('Settle Up', { exact: true }).first().click();

    await expect(page.getByText('Balances', { exact: true }).first()).toBeVisible({ timeout: 5000 });

    // Return home before checking 'overview' (now labeled "Itinerary"), which navigates to its own page.
    await goHome(page);
    await openTab(page, 'overview');

    await expect(page.getByTestId('overview-actions-menu')).toBeVisible();

    expect(jsErrors, `JS errors: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('overview tab shows trip name and participant section', async ({ page }) => {
    const tripName = await createTripViaWizard(page);

    await openTab(page, 'overview');


    // Trip name should appear somewhere in overview
    await expect(page.getByText(tripName)).toBeVisible({ timeout: 8000 });

    // The Travelers/participants section is only shown in edit mode.
    await page.getByTestId('overview-actions-menu').click();
    await page.getByText('Edit', { exact: true }).click();
    await expect(
      page.getByText(/participant|member|traveler|group/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('All Trips offers trip creation when no trips exist yet', async ({ page }) => {
    // No trip has been created in this test (beforeEach only logs in), so the
    // hero card should offer to create one rather than show a trip picker.
    await page.getByTestId('home-all-trips').click();

    await expect(page.getByTestId('all-trips-create-button')).toBeVisible();
    await expect(page.getByTestId(/^all-trips-row-/)).toHaveCount(0);
  });
});
