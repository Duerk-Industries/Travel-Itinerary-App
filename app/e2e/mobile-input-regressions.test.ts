import { expect, test, type Locator, type Page } from '@playwright/test';

// Browser layout tests use the real frontend with isolated, deterministic API data.
// They never sign in to or mutate an existing travel account.
async function boot(page: Page) {
  const user = { userId: 'input-user', role: 'user', email: 'input@example.com', firstName: 'Input', lastName: 'Tester', exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(user)).toString('base64url')}.test`;
  const members = [
    { id: 'member-a', userId: user.userId, firstName: 'Input', lastName: 'Tester', email: user.email, status: 'active' },
    { id: 'member-b', firstName: 'Second', lastName: 'Traveler', status: 'active' },
    { id: 'member-c', firstName: 'Third', lastName: 'Traveler', status: 'active' },
  ];
  const trip = { id: 'input-trip', groupId: 'input-group', groupName: 'Input group', name: 'Input regression trip', destination: 'Japan', startDate: '2027-05-10', endDate: '2027-05-12', currency: 'USD', createdAt: '2026-01-01' };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === '/api/account') json = { ...user, id: user.userId, dateOfBirth: '1990-01-01', entitlements: { costTracking: true }, tierKey: 'pro' };
    else if (path === '/api/trips') json = [trip];
    else if (path === '/api/groups') json = [{ id: 'input-group', name: 'Input group', ownerId: user.userId, members, invites: [] }];
    else if (path.endsWith('/members')) json = members;
    else if (path.endsWith('/covered-by')) json = {};
    else if (path === '/api/trips/input-trip/packing-list') json = {
      travelers: Array.from({ length: 12 }, (_, i) => ({ id: `packer-${i}`, name: `Traveler ${String(i + 1).padStart(2, '0')}` })),
      items: Array.from({ length: 30 }, (_, i) => ({ id: `pack-${i}`, label: `Packing item ${i + 1}`, category: 'Clothing', position: i, packedBy: [] })),
    };
    else if (path.endsWith('/privacy-preferences')) json = { productCollectionEnabled: false, diagnosticsCollectionEnabled: false, productConsentCurrent: true, diagnosticsConsentCurrent: true };
    await route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.addInitScript(({ token, email }) => {
    localStorage.setItem('stp.session', JSON.stringify({ token, name: 'Input Tester', email, role: 'user', page: 'home', tripId: 'input-trip', expiresAt: Date.now() + 3600000 }));
    localStorage.setItem('stp.session.token', token);
  }, { token, email: user.email });
  await page.goto('/');
  await expect(page.getByText('Input regression trip', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  if (await page.getByLabel('Home', { exact: true }).count()) await page.getByLabel('Home', { exact: true }).click();
  await expect(page.getByTestId('home-nav-tours')).toBeVisible({ timeout: 30000 });
}

async function keyboard(page: Page, height: number, top = 0) {
  // Desktop browsers cannot open a phone OS keyboard; simulate its visual
  // viewport change without shrinking the layout viewport (the important case).
  await page.evaluate(({ height, top }) => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: height },
      offsetTop: { configurable: true, value: top },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  }, { height, top });
  await expect.poll(async () => (await page.getByTestId('app-keyboard-viewport').boundingBox())?.height).toBe(height);
}

async function aboveKeyboard(page: Page, control: Locator, height: number, top = 0) {
  await control.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const box = await control.boundingBox();
    return !!box && box.y >= top && box.y + box.height <= top + height;
  }).toBe(true);
  // Visibility alone misses controls covered by another stacking layer.
  expect(await control.evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
}

for (const width of [390, 1280]) {
  test(`packing traveler names head their own columns before and after scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await page.getByTestId('home-nav-packing').click();
    const scroll = page.getByTestId('packing-matrix-web-scroll');
    await expect(scroll).toBeVisible();
    await scroll.scrollIntoViewIfNeeded();
    const verifyAlignment = async () => {
      for (let i = 0; i < 12; i++) {
        const header = page.getByTestId(`packing-matrix-web-header-packer-${i}`);
        await expect(header).toHaveText(`Traveler ${String(i + 1).padStart(2, '0')}`);
        const nameBox = (await header.boundingBox())!;
        for (const item of ['pack-0', 'pack-29']) {
          const cell = (await page.getByTestId(`packing-check-${item}-packer-${i}`).boundingBox())!;
          expect(Math.abs(cell.x - nameBox.x)).toBeLessThan(1);
          expect(Math.abs(cell.width - nameBox.width)).toBeLessThan(1);
        }
      }
    };
    await verifyAlignment();
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; });
    await expect.poll(() => scroll.evaluate(el => el.scrollTop > 0 && el.scrollLeft > 0)).toBe(true);
    await verifyAlignment();
    const header = page.getByTestId('packing-matrix-web-header-packer-11');
    const headerBox = (await header.boundingBox())!;
    const scrollBox = (await scroll.boundingBox())!;
    expect(Math.abs(headerBox.y - scrollBox.y)).toBeLessThan(3);
    expect(await header.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
  });

  test(`activity and expense actions remain reachable above the keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await page.getByTestId('home-nav-tours').click();
    await page.getByTestId('activity-add').click();
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Keyboard regression');
    for (const height of [480, 360]) {
      await keyboard(page, height);
      await aboveKeyboard(page, page.getByTestId('activity-save'), height);
    }
    await page.getByTestId('activity-cancel').click();
    await page.getByLabel('Home', { exact: true }).click();
    await page.getByTestId('home-nav-expenses').click();
    await page.getByTestId('expense-add-button').click();
    await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('60');
    await keyboard(page, 480, 80);
    await aboveKeyboard(page, page.getByTestId('expense-save'), 480, 80);
    await keyboard(page, 844);
    await page.getByTestId('expense-cancel').click();
    const account = width < 700 ? page.getByLabel('Account', { exact: true }) : page.getByText('Input Tester', { exact: true }).first();
    await account.click();
    await keyboard(page, 360);
    await aboveKeyboard(page, page.getByText('Save Profile', { exact: true }), 360);
    await aboveKeyboard(page, page.getByText('Terms of Service', { exact: true }), 360);
  });

  test(`Expense Covering selectors remain clickable and selectable over nearby content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await page.getByTestId('home-nav-expenses').click();
    await page.getByTestId('expense-balances-button').click();
    const first = page.getByTestId('covering-select-member-a');
    await first.scrollIntoViewIfNeeded();
    // Native HTML selects provide the browser's popup layer. Exercise its
    // keyboard selection, not only a synthetic change event/selectOption().
    await aboveKeyboard(page, first, 844);
    await first.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(first).toHaveValue('member-b');
    await page.getByTestId('covering-select-member-b').selectOption('member-c');
    await expect(page.getByTestId('covering-select-member-b')).toHaveValue('member-c');
    await expect(first).toHaveValue('member-b');
  });
}
