import { expect, type Page } from '@playwright/test';

export async function openLoginForm(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByTestId('auth-form')).toBeVisible();
}

export async function goHome(page: Page) {
  const bottomHome = page.getByTestId('bottom-tab-home');
  const topHome = page.getByLabel('Home', { exact: true });
  await expect(page.getByTestId('home-nav-overview').or(bottomHome).or(topHome).first()).toBeVisible();
  if (!(await page.getByTestId('home-nav-overview').isVisible())) {
    if (await bottomHome.isVisible()) await bottomHome.click();
    else await topHome.click();
  }
  await expect(page.getByTestId('home-nav-overview')).toBeVisible();
}

const headings: Record<string, string> = {
  flights: 'Flights', 'ground-transfers': 'Ground Transfers', lodging: 'Lodging',
  tours: 'Activities', car: 'Car Rentals', expenses: 'Daily Expenses', cost: 'Cost Report',
};

export async function openTab(page: Page, tabKey: string) {
  await goHome(page);
  if (tabKey === 'ledger') {
    await openTab(page, 'cost');
    await page.getByTestId('cost-settle-up').click();
    await expect(page.getByTestId('ledger-settlement')).toBeVisible();
    return;
  }
  await page.getByTestId(`home-nav-${tabKey}`).click();
  if (headings[tabKey]) await expect(page.getByText(headings[tabKey], { exact: true }).last()).toBeVisible();
  if (tabKey === 'overview') await expect(page.getByTestId('overview-actions-menu')).toBeVisible();
}

type AddKind = 'activity' | 'expense' | 'flight' | 'transfer' | 'lodging' | 'rental' | 'person' | 'blog';
const desktopAdd: Record<AddKind, [string, string]> = {
  activity: ['tours', 'activity-add'], expense: ['expenses', 'expense-add-button'],
  flight: ['flights', 'transfer-add'], transfer: ['ground-transfers', 'transfer-add'],
  lodging: ['lodging', 'lodging-add'], rental: ['car', 'car-rental-add'],
  person: ['overview', 'overview-add-traveler'], blog: ['blog', 'blog-add-photos'],
};

/** Exercise the phone's Add menu; desktop keeps each screen's own Add control. */
export async function addTripItem(page: Page, kind: AddKind) {
  if (await page.getByTestId('bottom-tab-add').isVisible()) {
    await page.getByTestId('bottom-tab-add').click();
    await page.getByTestId(`add-option-${kind}`).click();
    if (kind === 'activity') await page.getByTestId('add-item-option-activity').click();
  } else {
    if (kind === 'person') {
      await openTab(page, 'overview');
      await page.getByTestId('overview-actions-menu').click();
      await page.getByText('Add Traveler', { exact: true }).click();
      return;
    }
    const [tab, button] = desktopAdd[kind];
    if (!(await page.getByTestId(button).isVisible())) await openTab(page, tab);
    await page.getByTestId(button).click();
  }
}

/** The full wizard is now reached through All Trips and the quick-start screen. */
export async function openTripWizard(page: Page) {
  await goHome(page);
  await page.getByTestId('home-all-trips').click();
  await page.getByTestId('all-trips-create-button').click();
  const customize = page.getByTestId('quick-start-customize');
  const fullWizard = page.getByText('Create Trip Wizard', { exact: true });
  await expect(customize.or(fullWizard)).toBeVisible();
  if (await customize.isVisible()) {
    // Exercise dates explicitly when the quick-start feature is enabled.
    await page.getByTestId('quick-start-dates-scheduled').click();
    await page.getByTestId('quick-start-start-date').fill('');
    await page.getByTestId('quick-start-end-date').fill('');
    await customize.click();
  }
  await expect(page.getByText('Create Trip Wizard', { exact: true })).toBeVisible();
}

export async function chooseDestination(page: Page, name = 'Italy') {
  await page.getByPlaceholder(/Search (destinations|locations)/).fill(name);
  await page.getByTestId(/^location-suggestion-/).filter({ hasText: name }).first().click();
  await expect(page.getByTestId(/^selected-location-/).filter({ hasText: name })).toBeVisible();
}

export async function advanceWizardStep(page: Page) {
  const step = page.getByText(/^Step \d+ of \d+:/);
  const previous = await step.innerText();
  await page.getByText('Next', { exact: true }).click();
  await expect(step).not.toHaveText(previous);
  await expect(step).toBeVisible();
}
