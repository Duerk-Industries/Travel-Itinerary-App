import { test, expect, Page } from '@playwright/test';
import { loginAsNewUser, TEST_USER_PASSWORD } from './tests/test-utils';

test.describe('Account Management', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await loginAsNewUser(page);
  });

  test.beforeEach(async () => {
    // Navigate to the account page before each test
    await page.getByRole('button', { name: 'Account' }).click();
  });

  test('should allow a user to update their profile', async () => {
    const newFirstName = `TestUser-${Date.now()}`;

    // Wait for the account page to load and find the input
    const firstNameInput = page.getByPlaceholder('First name');
    await expect(firstNameInput).toBeVisible();

    // Update the first name
    await firstNameInput.fill(newFirstName);
    await page.getByRole('button', { name: 'Save Profile' }).click();

    // Check for success message (assuming alert is used)
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('Profile updated');
      dialog.dismiss().catch(() => {});
    });

    // Refresh the page and verify the change persists
    await page.reload();
    await expect(page.getByText(newFirstName, { exact: false })).toBeVisible();
  });

  test('should allow a user to change their password', async () => {
    const newPassword = `new-password-${Date.now()}`;

    await page.getByRole('button', { name: 'Change Password' }).click();

    // Fill out the password change form
    await page.getByPlaceholder('Current password').fill(TEST_USER_PASSWORD);
    await page.getByPlaceholder('New password').fill(newPassword);
    await page.getByPlaceholder('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Update Password' }).click();

    // Check for success message
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('Password updated');
      dialog.dismiss().catch(() => {});
    });

    // Log out
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();

    // Log back in with the new password
    const email = (await page.getByPlaceholder('Email').inputValue());
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(newPassword);
    await page.getByRole('button', { name: 'Login' }).click();

    // Expect to be logged in (e.g., see the logout button again)
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  });

  test('should allow a user to delete their account', async () => {
    // Start the delete process
    await page.getByRole('button', { name: 'Delete Account' }).click();

    // Confirm deletion in the modal
    await expect(page.getByText('Delete account?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // User should be logged out and see the login form
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  });
});