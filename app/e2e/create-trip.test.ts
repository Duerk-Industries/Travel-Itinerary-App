import { test, expect } from '@playwright/test';
import { loginAsNewUser } from './test-utils';

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
    // Navigate to the trips page to start
    await page.getByTestId('home-nav-trips').click();
    await expect(page.getByText('Open Wizard')).toBeVisible();

    // Open the wizard
    await page.getByText('Open Wizard').click();
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

    // The component for this step can be slow to become interactive. We use a
    // standard, robust pattern: click the button to reveal the calendar, then
    // wait for an element within the calendar to become visible.
    await page.getByText("I know which dates I'm going").click();
    await expect(page.getByText('15', { exact: true }).first()).toBeVisible();

    // Select a start and end date. The calendar dates might not have a 'button'
    // role, so we'll use `getByText` which is more reliable here.
    await page.getByText('15', { exact: true }).first().click();
    await page.getByText('17', { exact: true }).first().click();

    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 3: Participants
    await expect(page.getByText('Add Participants')).toBeVisible();
    await page.getByPlaceholder('Participant Name').fill('Test Friend');
    await page.getByPlaceholder('Participant Email').fill('friend@test.com');
    await page.waitForLoadState('networkidle');
    await page.getByText('Add').click();
    await expect(page.getByText('Test Friend (friend@test.com)')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Steps 4 & 5: Skip Flights and Lodging for simplicity
    await expect(page.getByText('Add Flights')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();
    await expect(page.getByText('Add Lodging')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Add assertions for each subsequent step to make the test more robust.
    // Note: The step titles 'Itinerary', 'Activities', and 'Notes' are assumed from comments.
    // Please adjust them if the actual titles are different.
    await expect(page.getByText('Itinerary', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();
    await expect(page.getByText('Activities', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();
    await expect(page.getByText('Notes', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();

    // Step 9: Review and Finish
    await expect(page.getByText('Review and Finish')).toBeVisible();
    await expect(page.getByText(tripName)).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Finish').click();

    // Verify the trip was created and is now active
    await expect(page.getByText(`Active Trip: ${tripName}`)).toBeVisible();
  });
});
