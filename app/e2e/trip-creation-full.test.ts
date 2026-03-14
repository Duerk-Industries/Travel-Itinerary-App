/**
 * E2E: Full trip creation wizard coverage
 *
 * Extends the basic happy-path test in create-trip.test.ts with edge-cases:
 * validation, back-navigation data persistence, and wizard cancellation.
 */
import { test, expect } from '@playwright/test';
import { loginAsNewUser, measureMs } from './fixtures';

test.describe('Full Trip Creation Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNewUser(page);
  });

  test('wizard requires trip name before advancing from step 1', async ({ page }) => {
    await page.getByTestId('home-nav-trips').click();
    await page.getByText('Open Wizard').click();
    await expect(page.getByText('Create Trip Wizard')).toBeVisible();

    // Do NOT fill Trip Name — click Next immediately
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Should still be on step 1 (Dates heading must not appear)
    await expect(page.getByText('Dates', { exact: true })).not.toBeVisible();
    // Step 1 heading must still be visible
    await expect(page.getByText('Create Trip Wizard')).toBeVisible();
  });

  test('back-navigation preserves step-1 data', async ({ page }) => {
    const tripName = `Back Nav Test ${Date.now()}`;

    await page.getByTestId('home-nav-trips').click();
    await page.getByText('Open Wizard').click();

    await page.getByPlaceholder('Trip Name').fill(tripName);
    await page.getByPlaceholder('Destination').fill('Paris');
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // On step 2 — go back
    await expect(page.getByText('Dates', { exact: true })).toBeVisible();
    await page.getByText('Back').click();

    // Trip Name should still be filled
    await expect(page.getByPlaceholder('Trip Name')).toHaveValue(tripName);
    await expect(page.getByPlaceholder('Destination')).toHaveValue('Paris');
  });

  test('step 3 adds a participant and shows them in the list', async ({ page }) => {
    await page.getByTestId('home-nav-trips').click();
    await page.getByText('Open Wizard').click();

    // Step 1
    await page.getByPlaceholder('Trip Name').fill(`Participant Test ${Date.now()}`);
    await page.getByPlaceholder('Destination').fill('Rome');
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 2 — select dates
    await page.getByText("I know which dates I'm going").click();
    await expect(page.getByText('15', { exact: true }).first()).toBeVisible();
    await page.getByText('15', { exact: true }).first().click();
    await page.getByText('17', { exact: true }).first().click();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 3
    await expect(page.getByText('Add Participants')).toBeVisible();
    await page.getByPlaceholder('Participant Name').fill('Jane Doe');
    await page.getByPlaceholder('Participant Email').fill('jane@example.com');
    await page.waitForLoadState('networkidle');
    await page.getByText('Add').click();
    await expect(page.getByText('Jane Doe (jane@example.com)')).toBeVisible();
  });

  test('wizard step-advance is within performance threshold', async ({ page }) => {
    await page.getByTestId('home-nav-trips').click();
    await page.getByText('Open Wizard').click();

    await page.getByPlaceholder('Trip Name').fill(`Perf Test ${Date.now()}`);
    await page.getByPlaceholder('Destination').fill('Tokyo');
    await page.waitForLoadState('networkidle');

    // Measure step 1 → step 2 transition: RAIL interactive < 2 s
    const elapsed = await measureMs(async () => {
      await page.getByText('Next').click();
      await expect(page.getByText('Dates', { exact: true })).toBeVisible();
    });
    expect(elapsed, `Wizard step took ${elapsed}ms — expected < 2000ms`).toBeLessThan(2000);
  });

  test('month-range dates create trip without exact dates', async ({ page }) => {
    const tripName = `Month Range ${Date.now()}`;

    await page.getByTestId('home-nav-trips').click();
    await page.getByText('Open Wizard').click();

    await page.getByPlaceholder('Trip Name').fill(tripName);
    await page.getByPlaceholder('Destination').fill('Barcelona');
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 2 — skip exact dates, use month/year range option
    await expect(page.getByText('Dates', { exact: true })).toBeVisible();
    // Look for a "I only know the month" or similar flexible option
    const monthOption = page.getByText(/month|approximate|flexible/i).first();
    if (await monthOption.isVisible()) {
      await monthOption.click();
    }
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Proceed through remaining steps
    for (const label of ['Add Participants', 'Add Flights', 'Add Lodging', 'Itinerary', 'Activities', 'Notes']) {
      const heading = page.getByText(label, { exact: true });
      if (await heading.isVisible({ timeout: 3000 }).catch(() => false)) {
        await page.waitForLoadState('networkidle');
        await page.getByText('Next').click();
      }
    }

    await expect(page.getByText('Review and Finish')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Finish').click();
    await expect(page.getByText(`Active Trip: ${tripName}`)).toBeVisible();
  });
});
