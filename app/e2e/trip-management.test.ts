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

  test('newly created trip appears in the trips list', async ({ page }) => {
    const tripName = await createTripViaWizard(page);

    // Navigate to trips list
    await page.getByTestId('home-nav-trips').click();
    await page.waitForLoadState('networkidle');

    // The trip name should appear in the list
    await expect(page.getByText(tripName)).toBeVisible({ timeout: 8000 });
  });

  test('user can switch active trip', async ({ page }) => {
    const tripName1 = await createTripViaWizard(page, { tripName: `Trip Alpha ${Date.now()}` });
    const tripName2 = await createTripViaWizard(page, { tripName: `Trip Beta ${Date.now() + 1}` });

    // Trip 2 is active after being created — switch to Trip 1
    await page.getByTestId('home-nav-trips').click();
    await page.waitForLoadState('networkidle');

    const elapsed = await measureMs(async () => {
      await page.getByText(tripName1).click();
      await expect(page.getByText(`Active Trip: ${tripName1}`)).toBeVisible({ timeout: 3000 });
    });

    expect(elapsed, `Trip switch took ${elapsed}ms — expected < 3000ms`).toBeLessThan(3000);

    // Confirm trip 2 is no longer the active heading
    await expect(page.getByText(`Active Trip: ${tripName2}`)).not.toBeVisible();
  });

  test('all main tabs load without JavaScript errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await createTripViaWizard(page);

    const tabs: Array<[string, string]> = [
      ['overview', 'Overview'],
      ['flights', 'Transfers'],
      ['lodging', 'Lodging'],
      ['tours', 'Activities'],
      ['expenses', 'Daily Expenses'],
      ['ledger', 'Ledger'],
    ];

    for (const [tabKey, heading] of tabs) {
      await page.getByTestId(`home-nav-${tabKey}`).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText(heading).first()).toBeVisible({ timeout: 5000 });
    }

    expect(jsErrors, `JS errors: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('overview tab shows trip name and participant section', async ({ page }) => {
    const tripName = await createTripViaWizard(page);

    await page.getByTestId('home-nav-overview').click();
    await page.waitForLoadState('networkidle');

    // Trip name should appear somewhere in overview
    await expect(page.getByText(tripName)).toBeVisible({ timeout: 8000 });
    // Participants / group section heading
    await expect(
      page.getByText(/participant|member|traveler|group/i).first(),
    ).toBeVisible({ timeout: 8000 });
  });

  test('trips tab is accessible from home nav', async ({ page }) => {
    await page.getByTestId('home-nav-trips').click();
    await page.waitForLoadState('networkidle');

    // The page should show either the trip list or the Open Wizard prompt
    const hasList = await page.getByText(/Trip|Upcoming|Active/i).first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasWizard = await page.getByText('Open Wizard').isVisible({ timeout: 1000 }).catch(() => false);
    expect(hasList || hasWizard, 'Trips tab must show trip list or wizard prompt').toBeTruthy();
  });
});
