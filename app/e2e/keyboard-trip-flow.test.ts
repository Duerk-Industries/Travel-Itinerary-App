/**
 * E2E: Keyboard-only navigation into the Trip Wizard (Priority 14).
 *
 * Layers on top of the keyboard-auth-flow spec: once a user has logged in,
 * they must be able to open Trips → Create Trip Wizard → fill the name →
 * advance to step 2 without ever touching a pointer. If the Create Trip
 * button, the wizard's Trip Name input, or its Next button regresses to a
 * non-focusable element, this test fails.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAsNewUser } from './fixtures';

const MAX_TAB_PRESSES = 60;

/**
 * Press Tab until the focused element satisfies `predicate`, bailing after
 * `limit` presses. Runs the predicate in-page against a serialized
 * descriptor of `document.activeElement`.
 */
const tabUntilFocused = async (
  page: Page,
  predicate: (descriptor: {
    tag: string;
    role: string | null;
    placeholder: string | null;
    testId: string | null;
    text: string;
    ariaLabel: string | null;
  }) => boolean,
  label: string,
  limit = MAX_TAB_PRESSES,
): Promise<number> => {
  for (let i = 0; i < limit; i += 1) {
    const matches = await page.evaluate((predSource) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const descriptor = {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        placeholder: el.getAttribute('placeholder'),
        testId: el.getAttribute('data-testid'),
        text: (el.textContent ?? '').trim(),
        ariaLabel: el.getAttribute('aria-label'),
      };
      // eslint-disable-next-line no-new-func
      const fn = new Function('d', `return (${predSource})(d);`);
      return Boolean(fn(descriptor));
    }, predicate.toString());
    if (matches) return i;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab stop for "${label}" not reached within ${limit} presses.`);
};

const blurFocus = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body) el.blur?.();
  });
};

test.describe('Keyboard-only trip wizard', () => {
  test('can open the Trips tab via keyboard and advance the wizard to step 2', async ({ page }) => {
    // Programmatic login (not under test here — see keyboard-auth-flow.test.ts).
    await loginAsNewUser(page);
    await expect(page.getByTestId('home-nav-trips')).toBeVisible({ timeout: 15_000 });

    // Tab to Trips → activate with Enter.
    await blurFocus(page);
    const tabsToTrips = await tabUntilFocused(
      page,
      (d) => d.testId === 'home-nav-trips',
      'home-nav-trips',
    );
    expect(tabsToTrips).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // "Open Wizard" is rendered as a TouchableOpacity; match it by accessible
    // text. Tab to it and press Enter.
    await blurFocus(page);
    const tabsToWizard = await tabUntilFocused(
      page,
      (d) =>
        (d.role === 'button' || d.tag === 'button') &&
        (d.text === 'Open Wizard' || d.ariaLabel === 'Open Wizard'),
      'Open Wizard button',
    );
    expect(tabsToWizard).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // The wizard's first step (Trip Details) should render.
    await expect(page.getByText('Create Trip Wizard')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('Trip Name')).toBeVisible();

    // Tab to the Trip Name input and type.
    await blurFocus(page);
    const tabsToName = await tabUntilFocused(
      page,
      (d) => d.tag === 'input' && d.placeholder === 'Trip Name',
      'Trip Name input',
    );
    expect(tabsToName).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.type(`E2E KBD Trip ${Date.now()}`, { delay: 10 });

    // Tab to the Next button and activate it. The Trip Name alone is enough
    // to satisfy step 1's required-fields gate.
    const tabsToNext = await tabUntilFocused(
      page,
      (d) =>
        (d.role === 'button' || d.tag === 'button') &&
        (d.text === 'Next' || d.ariaLabel === 'Next' || d.text.startsWith('Next')),
      'Next button',
    );
    expect(tabsToNext).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // Step 2 label should appear.
    await expect(page.getByText('Dates', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
