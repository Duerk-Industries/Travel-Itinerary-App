/**
 * E2E: Keyboard-only Trip Sharing flow (Priority 14).
 *
 * Adds a third keyboard-only spec on top of the existing auth-flow and
 * trip-wizard specs. Covers: log in → create trip via wizard helpers → open
 * the Share Trip dialog → focus invite email input → type → Tab to Send →
 * Enter. If any of these controls regresses to a non-focusable element,
 * this test fails even though pointer-driven flows still work.
 */
import { test, expect, type Page } from '@playwright/test';
import { createTripViaWizard, loginAsNewUser } from './fixtures';

const MAX_TAB_PRESSES = 60;

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

test.describe('Keyboard-only trip sharing', () => {
  test('can Tab into the Share dialog, enter an invite email, and send via keyboard', async ({ page }) => {
    // Programmatic login + trip creation are preconditions (not under test).
    await loginAsNewUser(page);
    const tripName = await createTripViaWizard(page);
    expect(tripName).toBeTruthy();

    // Open the trip actions / share entry. The share surface is reached
    // from the home screen via the "Trip Details" page or a quick-action
    // menu — look for a button accessible as "Share" or containing that
    // text. Landing there must not require a pointer.
    await blurFocus(page);
    const tabsToShare = await tabUntilFocused(
      page,
      (d) =>
        (d.role === 'button' || d.tag === 'button') &&
        Boolean(d.ariaLabel?.toLowerCase().includes('share') || /share/i.test(d.text)),
      'Share trip button',
    );
    expect(tabsToShare).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // The share dialog renders an email input (placeholder "Email" or the
    // accessibility label identifies it). Tab to it and type.
    await blurFocus(page);
    const tabsToEmail = await tabUntilFocused(
      page,
      (d) =>
        d.tag === 'input' &&
        Boolean(
          d.placeholder?.toLowerCase().startsWith('email') ||
            d.ariaLabel?.toLowerCase().includes('email'),
        ),
      'share dialog email input',
    );
    expect(tabsToEmail).toBeLessThan(MAX_TAB_PRESSES);
    const inviteEmail = `kbd-share-${Date.now()}@example.com`;
    await page.keyboard.type(inviteEmail, { delay: 10 });

    // Tab to the Send / Invite / Share submit control and activate it.
    const tabsToSubmit = await tabUntilFocused(
      page,
      (d) =>
        (d.role === 'button' || d.tag === 'button') &&
        (/\b(send|invite|share)\b/i.test(d.text) || /\b(send|invite|share)\b/i.test(d.ariaLabel ?? '')),
      'share submit button',
    );
    expect(tabsToSubmit).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // A success signal is sufficient — the invitee email should appear
    // somewhere on screen, OR a confirmation toast/text. Be lenient since
    // the exact copy varies.
    await expect(
      page
        .getByText(inviteEmail)
        .or(page.getByText(/invite sent|sent invite|invitation sent/i))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
