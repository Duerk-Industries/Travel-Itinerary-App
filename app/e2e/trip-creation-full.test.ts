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
    await page.getByTestId('home-create-trip-button').click();
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

    await page.getByTestId('home-create-trip-button').click();

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
    await page.getByTestId('home-create-trip-button').click();

    // Step 1
    await page.getByPlaceholder('Trip Name').fill(`Participant Test ${Date.now()}`);
    await page.getByPlaceholder('Destination').fill('Rome');
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 2 — select dates (native <input type="date"> fields on web)
    await page.getByText("I know which dates I'm going").click();
    await expect(page.getByTitle('Start date')).toBeVisible();
    const startDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const endDate = new Date(startDate.getTime() + 2 * 24 * 60 * 60 * 1000);
    await page.getByTitle('Start date').fill(startDate.toISOString().slice(0, 10));
    await page.getByTitle('End date').fill(endDate.toISOString().slice(0, 10));
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 3
    await expect(page.getByText('Participants', { exact: true })).toBeVisible();
    await page.getByPlaceholder('First name').fill('Jane');
    await page.getByPlaceholder('Last name').fill('Doe');
    await page.getByPlaceholder('Email (optional)').fill('jane@example.com');
    await page.waitForLoadState('networkidle');
    await page.getByText('Add Participant').click();
    await expect(page.getByText('Jane Doe (jane@example.com)')).toBeVisible();
  });

  test('wizard step-advance is within performance threshold', async ({ page }) => {
    await page.getByTestId('home-create-trip-button').click();

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

    await page.getByTestId('home-create-trip-button').click();

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

    // Proceed through remaining steps (Participants, Itinerary, Flight
    // Details, Accommodation Details, Activities, Rental Cars) without
    // asserting exact order/labels — not what this test is checking.
    const reviewHeading = page.getByText('Review & Confirm', { exact: true });
    for (let i = 0; i < 8 && !(await reviewHeading.isVisible().catch(() => false)); i += 1) {
      await page.waitForLoadState('networkidle');
      // Itinerary gates "Next" behind an explicit Yes/No AI-generation choice.
      const skipAiItinerary = page.getByText('No', { exact: true });
      if (await skipAiItinerary.isVisible().catch(() => false)) {
        await skipAiItinerary.click();
        await page.waitForTimeout(200);
      }
      await page.getByText('Next', { exact: true }).click();
      await page.waitForTimeout(300);
    }

    await expect(reviewHeading).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Create Trip', { exact: true }).click();
    // Wizard closes and lands directly on the new trip's Overview page.
    await expect(page.getByText(tripName)).toBeVisible({ timeout: 10_000 });
  });
});
