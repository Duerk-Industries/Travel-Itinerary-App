/**
 * E2E: User-perceived performance thresholds (Google RAIL model)
 *
 * Thresholds are based on the RAIL model (https://web.dev/rail/):
 *   - Response (interaction feedback):    < 100 ms ideal  / < 1 000 ms acceptable
 *   - Animation frame budget:             < 16 ms  (60 fps)
 *   - Idle task slicing:                  < 50 ms per task
 *   - Load (page / route navigation):     < 1 000 ms ideal / < 3 000 ms "good" (Core Web Vitals)
 *
 * For a full-stack web app with a remote backend the practical thresholds used
 * here are more generous while still actionable:
 *
 *   | Journey                                | Budget   |
 *   |----------------------------------------|----------|
 *   | Login → home screen interactive        | 5 000 ms |
 *   | Trip selection → active trip visible   | 3 000 ms |
 *   | Tab switch (data already loaded)       | 1 500 ms |
 *   | Wizard step advance (Next → heading)   | 2 000 ms |
 *   | First Contentful Paint (FCP)           | 1 800 ms |  (Chromium CDP only)
 *
 * All measurements use wall-clock `Date.now()` brackets. Playwright's built-in
 * timeout assertions (`expect.toBeVisible({ timeout })`) enforce hard limits
 * — if an element does not appear within the budget the test fails.
 */
import { test, expect } from '@playwright/test';
import { loginAsNewUser, createTripViaWizard, openTab, measureMs } from './fixtures';

const THRESHOLDS = {
  loginToHome: 5_000,
  tripLoad: 3_000,
  tabSwitch: 1_500,
  wizardStep: 2_000,
  fcp: 1_800,
} as const;

test.describe('Performance Thresholds', () => {
  test('login to home screen is under budget', async ({ page }) => {
    const t0 = Date.now();
    await loginAsNewUser(page);
    const elapsed = Date.now() - t0;

    expect(elapsed, `Login took ${elapsed}ms — budget ${THRESHOLDS.loginToHome}ms`)
      .toBeLessThan(THRESHOLDS.loginToHome);
  });

  test('trip load after selection is under budget', async ({ page }) => {
    await loginAsNewUser(page);
    const tripName = await createTripViaWizard(page);

    // Navigate away so we can measure the trip-select journey
    await page.getByTestId('home-nav-trips').click();
    await page.waitForLoadState('networkidle');

    const elapsed = await measureMs(async () => {
      // Click the trip row to make it active again (may already be active)
      const tripRow = page.getByText(tripName).first();
      if (await tripRow.isVisible()) await tripRow.click();
      await expect(page.getByText(`Active Trip: ${tripName}`))
        .toBeVisible({ timeout: THRESHOLDS.tripLoad });
    });

    expect(elapsed, `Trip load took ${elapsed}ms — budget ${THRESHOLDS.tripLoad}ms`)
      .toBeLessThan(THRESHOLDS.tripLoad);
  });

  test('tab switch is under budget', async ({ page }) => {
    await loginAsNewUser(page);
    await createTripViaWizard(page);

    // Switch to Transfers tab and measure
    const elapsed = await measureMs(async () => {
      await page.getByTestId('home-nav-flights').click();
      await expect(page.getByText('Transfers')).toBeVisible({ timeout: THRESHOLDS.tabSwitch });
    });

    expect(elapsed, `Tab switch took ${elapsed}ms — budget ${THRESHOLDS.tabSwitch}ms`)
      .toBeLessThan(THRESHOLDS.tabSwitch);
  });

  test('multiple tab switches are each under budget', async ({ page }) => {
    await loginAsNewUser(page);
    await createTripViaWizard(page);

    const tabs: Array<[string, string]> = [
      ['flights', 'Transfers'],
      ['lodging', 'Lodging'],
      ['tours', 'Activities'],
      ['expenses', 'Daily Expenses'],
    ];

    for (const [tabKey, heading] of tabs) {
      const elapsed = await measureMs(async () => {
        await page.getByTestId(`home-nav-${tabKey}`).click();
        await expect(page.getByText(heading).first()).toBeVisible({ timeout: THRESHOLDS.tabSwitch });
      });
      expect(elapsed, `${heading} tab took ${elapsed}ms — budget ${THRESHOLDS.tabSwitch}ms`)
        .toBeLessThan(THRESHOLDS.tabSwitch);
    }
  });

  test('wizard step advance is under budget', async ({ page }) => {
    await loginAsNewUser(page);
    await page.getByTestId('home-nav-trips').click();
    await page.getByText('Open Wizard').click();
    await expect(page.getByText('Create Trip Wizard')).toBeVisible();

    await page.getByPlaceholder('Trip Name').fill(`Perf Wizard ${Date.now()}`);
    await page.getByPlaceholder('Destination').fill('Berlin');
    await page.waitForLoadState('networkidle');

    const elapsed = await measureMs(async () => {
      await page.getByText('Next').click();
      await expect(page.getByText('Dates', { exact: true }))
        .toBeVisible({ timeout: THRESHOLDS.wizardStep });
    });

    expect(elapsed, `Wizard step took ${elapsed}ms — budget ${THRESHOLDS.wizardStep}ms`)
      .toBeLessThan(THRESHOLDS.wizardStep);
  });

  test('First Contentful Paint via CDP is under budget', async ({ page, browserName }) => {
    // CDP metrics are Chromium-only
    test.skip(browserName !== 'chromium', 'CDP performance metrics are Chromium-only');

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto('/', { waitUntil: 'networkidle', timeout: 30_000 });
    const { metrics } = await cdp.send('Performance.getMetrics');

    const firstContentfulPaint = metrics.find((m: { name: string }) => m.name === 'FirstContentfulPaint');
    const navigationStart = metrics.find((m: { name: string }) => m.name === 'NavigationStart');

    if (firstContentfulPaint && navigationStart) {
      const fcpMs = (firstContentfulPaint.value - navigationStart.value) * 1000;
      expect(fcpMs, `FCP was ${fcpMs.toFixed(0)}ms — budget ${THRESHOLDS.fcp}ms`)
        .toBeLessThan(THRESHOLDS.fcp);
    } else {
      test.skip(true, 'FCP metric not available from CDP');
    }
  });
});
