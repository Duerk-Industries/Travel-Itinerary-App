/**
 * E2E: Keyboard-only navigation into the Daily Expenses flow (Priority 14).
 *
 * Extends the keyboard-trip-flow coverage by proving that once a trip exists,
 * a user can tab from Home → Daily Expenses → the Add Expense modal → the
 * Amount input without touching the mouse. If the expenses nav tile, the
 * "+ Add Expense" button, or the Amount input regresses to a non-focusable
 * element this test fails.
 */
import { test, expect, type Page } from '@playwright/test';
import { createTripViaWizard, loginAsNewUser } from './fixtures';

const MAX_TAB_PRESSES = 80;

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

test.describe('Keyboard-only expense flow', () => {
  test('can reach the Add Expense modal and type into the Amount input', async ({ page }) => {
    // Seed a trip with dates so the Daily Expenses tab renders its form rather
    // than the "add trip dates first" helper text.
    await loginAsNewUser(page);
    await createTripViaWizard(page);

    // createTripViaWizard leaves us on the home page with the new trip active;
    // the Daily Expenses nav tile is one of the `home-nav-*` grid buttons.
    await expect(page.getByTestId('home-nav-expenses')).toBeVisible({ timeout: 15_000 });

    await blurFocus(page);
    const tabsToExpenses = await tabUntilFocused(
      page,
      (d) => d.testId === 'home-nav-expenses',
      'home-nav-expenses',
    );
    expect(tabsToExpenses).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // The tab's "+ Add Expense" button is only rendered when the trip has
    // startDate/endDate, which createTripViaWizard sets.
    await expect(page.getByTestId('expense-add-button')).toBeVisible({ timeout: 10_000 });

    await blurFocus(page);
    const tabsToAddExpense = await tabUntilFocused(
      page,
      (d) => d.testId === 'expense-add-button',
      'expense-add-button',
    );
    expect(tabsToAddExpense).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // Modal appears.
    await expect(page.getByTestId('expense-add-modal')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('Amount')).toBeVisible();

    // Tab to the Amount input and type a value. Proves the modal's focus trap
    // doesn't skip past all fields.
    await blurFocus(page);
    const tabsToAmount = await tabUntilFocused(
      page,
      (d) => d.tag === 'input' && d.placeholder === 'Amount',
      'Amount input',
    );
    expect(tabsToAmount).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.type('12.50', { delay: 10 });

    await expect(page.getByPlaceholder('Amount')).toHaveValue('12.50');
  });
});
