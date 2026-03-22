import { test, expect } from '@playwright/test';
import { loginAsNewUser } from './test-utils';

test.describe('Create Trip Destination Autocomplete', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNewUser(page);
  });

  test('shows Italy from app data instead of the manual fallback', async ({ page }) => {
    // Capture what's in localStorage after login
    const sessionJson = await page.evaluate(() => window.localStorage.getItem('stp.session'));
    const session = sessionJson ? JSON.parse(sessionJson) : null;
    const tokenPrefix = session?.token ? session.token.substring(0, 20) : 'NULL';

    // Monitor API responses
    const apiLogs: string[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('localhost:3000/api')) {
        const authHeader = response.request().headers()['authorization'] ?? 'NONE';
        apiLogs.push(`${response.status()} ${response.request().method()} ${url.replace('http://localhost:3000', '')} auth=${authHeader.substring(0, 30)}`);
      }
    });

    await page.getByTestId('home-nav-create-trip').click();
    await page.waitForTimeout(3000);

    const wizardVisible = await page.getByText('Create Trip Wizard').isVisible();
    if (!wizardVisible) {
      throw new Error(
        `Create Trip Wizard not visible. Token prefix: ${tokenPrefix}\nAPI logs:\n${apiLogs.join('\n')}`
      );
    }

    const destinationInput = page.getByPlaceholder(
      /Search destinations, countries, or states|Search locations \(countries\/regions\/cities\)/
    );

    await destinationInput.fill('Italy');

    const italySuggestion = page.getByText('Italy', { exact: true }).first();
    await expect(italySuggestion).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('manual-country-option')).toHaveCount(0);

    await italySuggestion.click();
    await expect(page.getByTestId(/selected-location-/).filter({ hasText: 'Italy' })).toBeVisible();
  });
});
