/**
 * Shared E2E test helpers for the Travel Itinerary App.
 *
 * All helpers are thin wrappers around Playwright's Page/Browser APIs and
 * direct HTTP calls to the backend. They are deliberately free of app-specific
 * business logic so they remain stable as the UI evolves.
 */
import { type APIRequestContext, type Browser, type BrowserContext, type Page, expect } from '@playwright/test';

export const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';
export const TEST_USER_PASSWORD = 'password123';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserCredentials = {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

type StoredSession = {
  token: string;
  name: string;
  email?: string;
  role?: 'user' | 'admin';
  page?: string;
  pageHistory?: string[];
  tripId?: string | null;
  expiresAt: number;
};

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

/**
 * Registers a new unique test user via the API and returns their credentials.
 * Does NOT log in via the UI — use loginAsUser() for that step.
 */
export async function registerUser(
  request: APIRequestContext,
  overrides: Partial<UserCredentials> = {},
): Promise<UserCredentials> {
  const id = Date.now() + Math.floor(Math.random() * 10_000);
  const credentials: UserCredentials = {
    username: `testuser_${id}`,
    email: `testuser_${id}@example.com`,
    password: TEST_USER_PASSWORD,
    firstName: 'Test',
    lastName: `User_${id}`,
    ...overrides,
  };

  const res = await request.post(`${API_BASE}/api/web-auth/register`, {
    data: {
      email: credentials.email,
      password: credentials.password,
      passwordConfirm: credentials.password,
      firstName: credentials.firstName,
      lastName: credentials.lastName,
    },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `registerUser failed (${res.status()}): ${body}`,
    );
  }

  return credentials;
}

/**
 * Logs an already-registered user in via the UI and waits for the home screen.
 */
export async function loginAsUser(page: Page, credentials: UserCredentials): Promise<void> {
  const authRes = await page.request.post(`${API_BASE}/api/auth/oauth`, {
    data: { email: credentials.email, provider: 'google' },
  });
  if (!authRes.ok()) {
    const body = await authRes.text();
    throw new Error(`loginAsUser oauth bootstrap failed (${authRes.status()}): ${body}`);
  }
  const data = await authRes.json();
  const session: StoredSession = {
    token: String(data.token),
    name: `${credentials.firstName} ${credentials.lastName}`.trim() || credentials.email,
    email: credentials.email,
    role: data.user?.role === 'admin' ? 'admin' : 'user',
    page: 'home',
    pageHistory: [],
    tripId: null,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };
  await page.addInitScript((payload) => {
    window.localStorage.setItem('stp.session', JSON.stringify(payload));
  }, session);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByTestId('home-nav-trips')).toBeVisible({ timeout: 15_000 });
}

/**
 * Registers a new user AND logs them in. Returns their credentials for later
 * use (e.g. inviting them to a trip from another user's session).
 */
export async function loginAsNewUser(page: Page): Promise<UserCredentials> {
  const credentials = await registerUser(page.request);
  await loginAsUser(page, credentials);
  return credentials;
}

/**
 * Creates an isolated browser context (separate cookie jar / localStorage)
 * for a second user, registers them, and logs them in.
 * Both contexts share the same server, so data is visible across users.
 */
export async function createSecondUserContext(
  browser: Browser,
  overrides: Partial<UserCredentials> = {},
): Promise<{ context: BrowserContext; page: Page; credentials: UserCredentials }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const credentials = await registerUser(page.request, overrides);
  return { context, page, credentials };
}

// ---------------------------------------------------------------------------
// Trip helpers
// ---------------------------------------------------------------------------

/**
 * Drives the Create Trip Wizard through all 9 steps and returns the trip name.
 * Assumes the user is already logged in.
 */
export async function createTripViaWizard(
  page: Page,
  options: { tripName?: string; participantEmail?: string } = {},
): Promise<string> {
  const tripName = options.tripName ?? `E2E Trip ${Date.now()}`;

  await page.getByTestId('home-nav-trips').click();
  await expect(page.getByText('Open Wizard')).toBeVisible();
  await page.getByText('Open Wizard').click();
  await expect(page.getByText('Create Trip Wizard')).toBeVisible();

  // Step 1: Trip Details
  await page.getByPlaceholder('Trip Name').fill(tripName);
  await page.getByPlaceholder('Destination').fill('Test Destination');
  await page.waitForLoadState('networkidle');
  await page.getByText('Next').click();

  // Step 2: Dates
  await expect(page.getByText('Dates', { exact: true })).toBeVisible();
  await page.getByText("I know which dates I'm going").click();
  await expect(page.getByText('15', { exact: true }).first()).toBeVisible();
  await page.getByText('15', { exact: true }).first().click();
  await page.getByText('17', { exact: true }).first().click();
  await page.waitForLoadState('networkidle');
  await page.getByText('Next').click();

  // Step 3: Participants
  await expect(page.getByText('Add Participants')).toBeVisible();
  if (options.participantEmail) {
    await page.getByPlaceholder('Participant Name').fill('Invited Friend');
    await page.getByPlaceholder('Participant Email').fill(options.participantEmail);
    await page.waitForLoadState('networkidle');
    await page.getByText('Add').click();
    await expect(page.getByText(`Invited Friend (${options.participantEmail})`)).toBeVisible();
  }
  await page.waitForLoadState('networkidle');
  await page.getByText('Next').click();

  // Steps 4–8: skip Flights, Lodging, Itinerary, Activities, Notes
  for (const label of ['Add Flights', 'Add Lodging', 'Itinerary', 'Activities', 'Notes']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByText('Next').click();
  }

  // Step 9: Review & Finish
  await expect(page.getByText('Review and Finish')).toBeVisible();
  await expect(page.getByText(tripName)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.getByText('Finish').click();
  await expect(page.getByText(`Active Trip: ${tripName}`)).toBeVisible();

  return tripName;
}

/**
 * Clicks a home nav tab and waits for networkidle.
 */
export async function openTab(page: Page, tabKey: string): Promise<void> {
  await page.getByTestId(`home-nav-${tabKey}`).click();
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Performance helper
// ---------------------------------------------------------------------------

/**
 * Measures the elapsed wall-clock time of an async action.
 * Returns elapsed milliseconds.
 */
export async function measureMs(fn: () => Promise<void>): Promise<number> {
  const t0 = Date.now();
  await fn();
  return Date.now() - t0;
}

// ---------------------------------------------------------------------------
// Back-compat re-export for the original create-trip.test.ts
// ---------------------------------------------------------------------------
export { TEST_USER_PASSWORD as TEST_USER_PASSWORD_COMPAT };
