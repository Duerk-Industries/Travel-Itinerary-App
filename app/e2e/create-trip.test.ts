import { test, expect, Page } from '@playwright/test';
import { loginAsNewUser } from './test-utils';

test.describe('Create Trip Flow', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await loginAsNewUser(page);
  });

  test('should allow a user to create a new trip using the wizard', async () => {
    // Navigate to the trips page to start
    await page.getByRole('button', { name: 'Trips' }).click();
    await expect(page.getByText('Open Wizard')).toBeVisible();

    // Open the wizard
    await page.getByRole('button', { name: 'Open Wizard' }).click();
    await expect(page.getByText('Create a New Shared Trip')).toBeVisible();

    // Step 1: Trip Details
    const tripName = `My E2E Test Trip ${Date.now()}`;
    await page.getByPlaceholder('Trip Name').fill(tripName);
    await page.getByPlaceholder('Destination').fill('Test Destination');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: Participants
    await expect(page.getByText('Add Participants')).toBeVisible();
    await page.getByPlaceholder('Participant Name').fill('Test Friend');
    await page.getByPlaceholder('Participant Email').fill('friend@test.com');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Test Friend (friend@test.com)')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3 & 4: Skip Flights and Lodging for simplicity
    await expect(page.getByText('Add Flights')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Add Lodging')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 5: Review and Finish
    await expect(page.getByText('Review and Finish')).toBeVisible();
    await expect(page.getByText(tripName)).toBeVisible();
    await page.getByRole('button', { name: 'Finish' }).click();

    // Verify the trip was created and is now active
    await expect(page.getByText(`Active Trip: ${tripName}`)).toBeVisible();
  });
});