import { test, expect } from '@playwright/test';
import { loginAsNewUser } from './fixtures';

test.describe('Create Trip Flow', () => {
  // Using `beforeEach` ensures that each test runs in a clean, isolated context.
  // By using the `page` fixture, Playwright manages the browser context and page
  // lifecycle automatically, which is a best practice.
  test.beforeEach(async ({ page }) => {
    await loginAsNewUser(page);
  });

  test('should allow a user to create a new trip using the wizard', async ({
    page,
  }) => {
    // Open the wizard
    await page.getByTestId('home-create-trip-button').click();
    await expect(page.getByText('Create Trip Wizard')).toBeVisible();

    // Step 1: Trip Details
    const tripName = `My E2E Test Trip ${Date.now()}`;
    await page.getByPlaceholder('Trip Name').fill(tripName);
    await page.getByPlaceholder('Destination').fill('Test Destination');

    // Before each step transition, we wait for the network to be idle. This is a
    // robust strategy to prevent the test from clicking "Next" before the app's
    // client-side logic (like validation or state saving) has fully completed.
    // This prevents a class of race conditions that cause test flakiness.
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 2: Dates (optional)
    // The UI requires a date selection to proceed, so this step is not truly optional.
    await expect(page.getByText('Dates', { exact: true })).toBeVisible();

    // Web renders native <input type="date"> fields for the start/end dates.
    await page.getByText("I know which dates I'm going").click();
    await expect(page.getByTitle('Start date')).toBeVisible();
    const startDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const endDate = new Date(startDate.getTime() + 2 * 24 * 60 * 60 * 1000);
    await page.getByTitle('Start date').fill(startDate.toISOString().slice(0, 10));
    await page.getByTitle('End date').fill(endDate.toISOString().slice(0, 10));

    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 3: Participants
    await expect(page.getByText('Participants', { exact: true })).toBeVisible();
    await page.getByPlaceholder('First name').fill('Test');
    await page.getByPlaceholder('Last name').fill('Friend');
    await page.getByPlaceholder('Email (optional)').fill('friend@test.com');
    await page.waitForLoadState('networkidle');
    await page.getByText('Add Participant').click();
    await expect(page.getByText('Test Friend (friend@test.com)')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Steps 4–8: Itinerary, Flight Details, Accommodation Details, Activities,
    // Rental Cars — skipped for this happy-path test.
    for (const label of ['Itinerary', 'Flight Details', 'Accommodation Details', 'Activities', 'Rental Cars']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Itinerary gates "Next" behind an explicit Yes/No AI-generation choice.
      const skipAiItinerary = page.getByText('No', { exact: true });
      if (await skipAiItinerary.isVisible().catch(() => false)) {
        await skipAiItinerary.click();
      }
      await page.getByText('Next', { exact: true }).click();
    }

    // Step 9: Review & Confirm
    await expect(page.getByText('Review & Confirm', { exact: true })).toBeVisible();
    await expect(page.getByText(tripName)).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Create Trip', { exact: true }).click();

    // Wizard closes and lands directly on the new trip's Overview page.
    await expect(page.getByText(tripName)).toBeVisible({ timeout: 10_000 });
  });
});
