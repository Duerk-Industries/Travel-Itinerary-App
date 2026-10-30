import { addTripItem, goHome, openTab } from './ui';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Browser layout tests use the real frontend with isolated, deterministic API data.
// They never sign in to or mutate an existing travel account.
async function boot(page: Page, expenses: unknown[] = []) {
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
    else if (path === '/api/expenses') json = expenses;
    else if (path === '/api/groups') json = [{ id: 'input-group', name: 'Input group', ownerId: user.userId, members, invites: [] }];
    else if (path.endsWith('/members')) json = [members[2], members[0], members[1]];
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
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Input regression trip', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await goHome(page);
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

async function expectReadable(text: Locator) {
  await expect(text).toBeVisible();
  const ratio = await text.evaluate(element => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (values: number[]) => values.slice(0, 3).map(channel => {
      const v = channel / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(rgb(getComputedStyle(element).color));
    let ancestor: Element | null = element;
    while (ancestor) {
      const background = rgb(getComputedStyle(ancestor).backgroundColor);
      if (background.length === 3 || background[3] === 1) {
        const bg = luminance(background);
        return (Math.max(foreground, bg) + 0.05) / (Math.min(foreground, bg) + 0.05);
      }
      ancestor = ancestor.parentElement;
    }
    return 0;
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for (const width of [390, 1280]) {
  test(`trip screens expose the correct Add controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    for (const [tab, addButton, option] of [
      ['flights', 'transfer-add', 'flight'],
      ['ground-transfers', 'transfer-add', 'transfer'],
      ['lodging', 'lodging-add', 'lodging'],
      ['tours', 'activity-add', 'activity'],
      ['car', 'car-rental-add', 'rental'],
      ['expenses', 'expense-add-button', 'expense'],
    ]) {
      await openTab(page, tab);
      if (width < 680) {
        await expect(page.getByTestId(addButton)).toHaveCount(0);
        await expect(page.getByTestId(/^(transfer|lodging|activity|car-rental)-table-edit$/)).toHaveCount(0);
        await expect(page.getByTestId('transfer-paste')).toHaveCount(0);
        await page.getByTestId('bottom-tab-add').click();
        await expect(page.getByTestId(`add-option-${option}`)).toBeVisible();
        await expect(page.getByTestId('add-option-person')).toBeVisible();
        await page.getByTestId('add-sheet-cancel').click();
      } else {
        await expect(page.getByTestId('bottom-tab-bar')).toHaveCount(0);
        await expect(page.getByTestId(addButton)).toBeVisible();
      }
    }
  });

  for (const mode of ['light', 'dark'] as const) {
    test(`shared theme keeps actions and settlement readable in ${mode} mode at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: mode === 'light' ? 'dark' : 'light' });
      await page.addInitScript(mode => localStorage.setItem('stp.appearancePreference', mode), mode);
      await boot(page);
      await openTab(page, 'cost');
      await expectReadable(page.getByText('Download Cost Details', { exact: true }));
      await page.getByTestId('cost-settle-up').click();
      const settlement = page.getByTestId('ledger-settlement');
      await expect(settlement).toBeVisible();
      await expect(settlement).toHaveCSS('background-color', mode === 'dark' ? 'rgb(17, 17, 17)' : 'rgb(244, 244, 244)');
      await expectReadable(settlement.getByText('Settlement', { exact: true }));
      await expectReadable(width < 700
        ? settlement.getByText('Everyone is settled up.', { exact: true })
        : settlement.getByText(/Each row shows what that traveler owes/));
      await page.screenshot({ path: `output/playwright/central-theme-${mode}-${width}.png` });
    });

    test(`anonymous public blog respects ${mode} appearance at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: mode === 'light' ? 'dark' : 'light' });
      await page.addInitScript(mode => localStorage.setItem('stp.appearancePreference', mode), mode);
      await page.route('**/public/blog/**', route => {
        const url = route.request().url();
        return route.fulfill(url.includes('engagement') ? { status: 404, json: {} } : { json: url.endsWith('/maps') ? { days: [] } : {
          title: 'A themed public story', days: [{ localDate: '2027-05-10', headline: 'A day in Kyoto', summary: '', items: [{ id: 'post', kindKey: 'core.text', body: 'A walk through the gardens.' }] }],
        } });
      });
      await page.goto('/theme-reader/example-trip', { waitUntil: 'domcontentloaded' });
      await expectReadable(page.getByText('A themed public story', { exact: true }));
      await expectReadable(page.getByText('A walk through the gardens.', { exact: true }));
      await page.screenshot({ path: `output/playwright/public-theme-${mode}-${width}.png` });
    });
  }

  test(`individual non-zero expenses appear after the Cost Report and not on Daily Expenses at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const base = { tripId: 'input-trip', groupId: 'input-group', userId: 'input-user', expenseDate: '2027-05-10', category: 'Lunch', currency: 'USD', payerIds: ['member-a'], forIds: ['member-a'], createdAt: '' };
    await boot(page, [
      { ...base, id: 'lunch-a', vendor: 'Lunch at cafe', amount: 15 },
      { ...base, id: 'lunch-b', vendor: 'Lunch at market', amount: 20 },
      { ...base, id: 'free', vendor: 'Free meal', amount: 0 },
    ]);
    await openTab(page, 'cost');
    const details = page.getByTestId('other-expenses');
    await expect(details.getByTestId(/^other-expense-row-/)).toHaveCount(2);
    await expect(details.getByText('Lunch at cafe', { exact: true })).toBeVisible();
    await expect(details.getByText('Lunch at market', { exact: true })).toBeVisible();
    await expect(details.getByText('Free meal', { exact: true })).toHaveCount(0);
    const settleBounds = await page.getByTestId('cost-settle-up').boundingBox();
    const detailsBounds = await details.boundingBox();
    expect(detailsBounds!.y).toBeGreaterThan(settleBounds!.y);
    await goHome(page);
    await openTab(page, 'expenses');
    await expect(page.getByTestId('other-expenses')).toHaveCount(0);
  });

  test(`cost details download both CSVs and Settle Up follows the report at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await openTab(page, 'cost');
    const download = page.getByRole('button', { name: 'Download Cost Details', exact: true });
    await expect(download).toHaveCount(1);
    await expect(page.getByText('Export Paid CSV', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Export Incurred CSV', { exact: true })).toHaveCount(0);
    const downloads: string[] = [];
    page.on('download', file => downloads.push(file.suggestedFilename()));
    await download.click();
    await expect.poll(() => downloads).toEqual(['Who_Paid.csv', 'Who_Spent_Money.csv']);
    const settle = page.getByTestId('cost-settle-up');
    const total = page.getByText('Overall', { exact: true });
    await settle.scrollIntoViewIfNeeded();
    const totalBounds = await total.boundingBox();
    const settleBounds = await settle.boundingBox();
    expect(totalBounds).not.toBeNull();
    expect(settleBounds!.y).toBeGreaterThanOrEqual(totalBounds!.y + totalBounds!.height);
    await settle.click();
    await expect(page.getByTestId('cost-details-download')).toHaveCount(0);
  });

  test(`payer dropdowns replace one alphabetized choice at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await openTab(page, 'tours');
    await addTripItem(page, 'activity');
    const activityPayer = page.getByTestId('activity-payer');
    await expect(activityPayer.locator('option')).toHaveText(['Select payer', 'Input Tester', 'Second Traveler', 'Third Traveler']);
    await activityPayer.selectOption('member-b');
    await activityPayer.selectOption('member-c');
    await expect(activityPayer).toHaveValue('member-c');
    expect(await activityPayer.evaluate((el: HTMLSelectElement) => el.multiple)).toBe(false);
    await page.getByTestId('activity-cancel').click();
    await goHome(page);
    await openTab(page, 'expenses');
    await addTripItem(page, 'expense');
    const expensePayer = page.getByTestId('expense-payer');
    await expect(expensePayer.locator('option')).toHaveText(['Select payer', 'Input Tester', 'Second Traveler', 'Third Traveler']);
    await expensePayer.selectOption('member-c');
    await expensePayer.selectOption('member-b');
    await expect(expensePayer).toHaveValue('member-b');
    expect(await expensePayer.evaluate((el: HTMLSelectElement) => el.selectedOptions.length)).toBe(1);
  });

  test(`packing traveler names head their own columns before and after scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await openTab(page, 'packing');
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
    await openTab(page, 'tours');
    await addTripItem(page, 'activity');
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Keyboard regression');
    for (const height of [480, 360]) {
      await keyboard(page, height);
      await aboveKeyboard(page, page.getByTestId('activity-save'), height);
    }
    await page.getByTestId('activity-cancel').click();
    await goHome(page);
    await openTab(page, 'expenses');
    await addTripItem(page, 'expense');
    await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('60');
    await keyboard(page, 480, 80);
    await aboveKeyboard(page, page.getByTestId('expense-save'), 480, 80);
    await keyboard(page, 844);
    await page.getByTestId('expense-cancel').click();
    const account = width < 700 ? page.getByRole('tab', { name: 'Profile', exact: true }) : page.getByText('Input Tester', { exact: true }).first();
    await account.click();
    await keyboard(page, 360);
    await aboveKeyboard(page, page.getByText('Save Profile', { exact: true }), 360);
    await aboveKeyboard(page, page.getByText('Terms of Service', { exact: true }), 360);
  });

  test(`Expense Covering selectors remain clickable and selectable over nearby content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await openTab(page, 'expenses');
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
