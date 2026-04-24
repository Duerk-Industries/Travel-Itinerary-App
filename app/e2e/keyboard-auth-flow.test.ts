/**
 * E2E: Keyboard-only login flow.
 *
 * Priority 14 (Accessibility) coverage: proves that a pointer-free user can
 * reach the login form, fill credentials, and submit — then perform one
 * post-auth navigation entirely via Tab/Enter. If RN-Web regresses focus
 * order or drops `accessibilityRole` on a critical element, this test fails
 * even though the mouse flow still works.
 */
import { test, expect, type Page } from '@playwright/test';
import { registerUser } from './fixtures';

const MAX_TAB_PRESSES = 40;

/**
 * Press Tab until the focused element satisfies `predicate`, or bail after
 * `limit` presses. The predicate runs in the browser context against
 * `document.activeElement`. Returns the number of Tab presses used.
 */
const tabUntilFocused = async (
  page: Page,
  predicate: (elementDescriptor: {
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

test.describe('Keyboard-only accessibility', () => {
  test('can log in using only Tab + keyboard (no pointer input)', async ({ page }) => {
    // Pre-register via API so the flow under test is strictly login —
    // registration keyboard coverage is a separate future slice.
    const credentials = await registerUser(page.request);

    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(page.getByPlaceholder('Email or Username')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('Password')).toBeVisible();

    await blurFocus(page);

    // Tab forward until the email field is focused. The placeholder on the
    // login screen today is "Email or Username" — any input whose placeholder
    // starts with "Email" matches.
    const tabsToEmail = await tabUntilFocused(
      page,
      (d) => d.tag === 'input' && !!d.placeholder && d.placeholder.startsWith('Email'),
      'email input',
    );
    expect(tabsToEmail).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.type(credentials.email, { delay: 10 });

    // Tab → password should be a single Tab stop (asserts no hidden focus
    // trap between the two credential inputs).
    await page.keyboard.press('Tab');
    const onPassword = await page.evaluate(
      () => document.activeElement?.getAttribute('placeholder') === 'Password',
    );
    expect(onPassword).toBe(true);
    await page.keyboard.type(credentials.password, { delay: 10 });

    // Tab forward until the Login button is focused, then activate it.
    // RN-Web's TouchableOpacity renders as a div with role=button; the
    // accessible text is the inner Text's content. We tolerate either the
    // button element itself or any descendant bearing the "Login" text.
    const tabsToSubmit = await tabUntilFocused(
      page,
      (d) =>
        (d.role === 'button' || d.tag === 'button') &&
        (d.text === 'Login' || d.ariaLabel === 'Login' || d.text.startsWith('Login')),
      'Login button',
    );
    expect(tabsToSubmit).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // Post-auth landing must be reachable without any pointer event.
    await expect(page.getByTestId('home-nav-trips')).toBeVisible({ timeout: 15_000 });
  });

  test('after login, can Tab to the Trips nav and activate it via keyboard', async ({ page }) => {
    // Programmatic login (not under test) so we arrive at home deterministically;
    // focus here is on post-auth keyboard navigation.
    const credentials = await registerUser(page.request);
    const authRes = await page.request.post(
      `${process.env.API_BASE_URL ?? 'http://127.0.0.1:4000'}/api/web-auth/login`,
      { data: { email: credentials.email, password: credentials.password } },
    );
    expect(authRes.ok()).toBe(true);
    const data = await authRes.json();
    await page.addInitScript((token) => {
      const session = {
        token,
        name: 'KBD Test',
        email: `${token.slice(0, 8)}@example.com`,
        role: 'user' as const,
        page: 'home',
        pageHistory: [],
        tripId: null,
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      };
      window.localStorage.setItem('stp.session', JSON.stringify(session));
      window.localStorage.setItem('stp.session.token', token);
    }, String(data.token));
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await expect(page.getByTestId('home-nav-trips')).toBeVisible({ timeout: 15_000 });

    await blurFocus(page);
    const tabs = await tabUntilFocused(
      page,
      (d) => d.testId === 'home-nav-trips',
      'home-nav-trips',
    );
    expect(tabs).toBeLessThan(MAX_TAB_PRESSES);
    await page.keyboard.press('Enter');

    // Trips tab renders a "Your Trips" heading or an "Open Wizard" button —
    // either is sufficient proof the Enter press dispatched.
    await expect(
      page.getByText(/open wizard/i).or(page.getByText(/your trips/i)).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
