/**
 * E2E: CRUD operations on trip content
 *
 * Tests add / edit / delete for all five entity types:
 *   Transfers, Lodging, Activities, Car Rentals, Daily Expenses
 *
 * Items are pre-created via direct API calls where possible to keep tests
 * fast and focused on the editing behaviour rather than the creation UI.
 */
import { test, expect } from '@playwright/test';
import { API_BASE, loginAsNewUser, createTripViaWizard, openTab, measureMs } from './fixtures';

// ---------------------------------------------------------------------------
// Helper: resolve auth headers from an already-logged-in page
// ---------------------------------------------------------------------------
async function getAuthHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const token = await page.evaluate((): string | null => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const val = localStorage.getItem(key) ?? '';
      if (val.startsWith('eyJ')) return val;
    }
    return null;
  });
  if (!token) throw new Error('No JWT token found in localStorage');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ---------------------------------------------------------------------------
// Helper: decode the current user's id from their JWT (needed as a
// passengerId — /api/transfers rejects requests with no passengers).
// ---------------------------------------------------------------------------
async function getUserId(page: import('@playwright/test').Page): Promise<string> {
  const headers = await getAuthHeaders(page);
  const token = headers.Authorization.replace('Bearer ', '');
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return payload.userId;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
let tripId: string;

// Trip fixture data must use dates that are (a) not in the past — the API
// rejects past dates — and (b) within the trip's own date range for entities
// scoped to a specific trip day (Activities, Daily Expenses). These mirror
// the offsets createTripViaWizard uses when creating the trip itself.
const tripStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const day1 = isoDate(tripStart);
const day2 = isoDate(new Date(tripStart.getTime() + 1 * 24 * 60 * 60 * 1000));

test.describe('Trip Content Editing', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsNewUser(page);
    await createTripViaWizard(page);

    // Capture the active trip ID from the page state
    tripId = await page.evaluate((): string => {
      const match = document.body.innerHTML.match(/trip[_-]?id['":\s]+([a-zA-Z0-9_-]{6,})/i);
      return match?.[1] ?? '';
    }).catch(() => '');

    // Fallback: extract from API via the trips list
    if (!tripId) {
      const headers = await getAuthHeaders(page);
      const res = await page.request.get(`${API_BASE}/api/trips`, { headers });
      if (res.ok()) {
        const data = await res.json();
        const trips: Array<{ id: string }> = Array.isArray(data) ? data : (data.trips ?? []);
        if (trips.length) tripId = trips[0].id;
      }
    }
  });

  // -------------------------------------------------------------------------
  // Transfers
  // -------------------------------------------------------------------------
  test.describe('Transfers', () => {
    test('adds a transfer via the flight editing modal', async ({ page }) => {
      await openTab(page, 'flights');
      await expect(page.getByText('Transfers')).toBeVisible();

      // Open the modal
      await page.getByTestId('transfer-add').click();
      // TransferEditingForm has explicit testIDs for its fields
      await page.getByTestId('flight-modal-carrier').fill('Test Air');
      await page.getByTestId('flight-modal-flight-number').fill('TA001');
      await page.getByTestId('flight-modal-save').click();
      await page.waitForLoadState('networkidle');

      // A row with this carrier text should appear
      await expect(page.getByText('Test Air')).toBeVisible({ timeout: 8000 });
    });

    test('edits a transfer via edit button', async ({ page }) => {
      // Pre-create via API
      const headers = await getAuthHeaders(page);
      const userId = await getUserId(page);
      const createRes = await page.request.post(`${API_BASE}/api/transfers`, {
        headers,
        data: {
          tripId,
          passengerIds: [userId],
          departureLocation: 'JFK',
          arrivalLocation: 'LAX',
          carrier: 'OriginalAir',
          flightNumber: 'OA100',
          departureDate: day1,
          departureTime: '10:00',
          arrivalTime: '13:00',
          type: 'Flight',
        },
      });
      expect(createRes.ok(), `pre-create transfer failed: ${await createRes.text()}`).toBeTruthy();
      const { id: transferId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await openTab(page, 'flights');

      const elapsed = await measureMs(async () => {
        await page.getByTestId(`transfer-edit-${transferId}`).click();
        await expect(page.getByTestId('flight-modal-carrier')).toBeVisible();
      });
      expect(elapsed, `Edit modal open took ${elapsed}ms — expected < 1500ms`).toBeLessThan(1500);

      await page.getByTestId('flight-modal-carrier').fill('UpdatedAir');
      await page.getByTestId('flight-modal-save').click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('UpdatedAir')).toBeVisible({ timeout: 8000 });
    });

    test('deletes a transfer', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const userId = await getUserId(page);
      const createRes = await page.request.post(`${API_BASE}/api/transfers`, {
        headers,
        data: {
          tripId,
          passengerIds: [userId],
          departureLocation: 'ORD',
          arrivalLocation: 'MIA',
          carrier: 'DeleteAir',
          flightNumber: 'DA999',
          departureDate: day2,
          departureTime: '08:00',
          arrivalTime: '11:00',
          type: 'Flight',
        },
      });
      expect(createRes.ok(), `pre-create transfer failed: ${await createRes.text()}`).toBeTruthy();
      const { id: transferId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await openTab(page, 'flights');

      await page.getByTestId(`transfer-delete-${transferId}`).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId(`transfer-row-${transferId}`)).not.toBeVisible({ timeout: 6000 });
    });
  });

  // -------------------------------------------------------------------------
  // Lodging
  // -------------------------------------------------------------------------
  test.describe('Lodging', () => {
    test('adds lodging via the + button', async ({ page }) => {
      await openTab(page, 'lodging');
      await page.getByTestId('lodging-add').click();
      await expect(page.getByTestId('lodging-editor-dialog')).toBeVisible({ timeout: 5000 });

      // LodgingDialog form — fill the name field
      await page.getByPlaceholder(/name|hotel|accommodation/i).first().fill('Test Hotel');
      await page.getByText('Save').click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Test Hotel')).toBeVisible({ timeout: 8000 });
    });

    test('edits lodging name', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const createRes = await page.request.post(`${API_BASE}/api/lodgings`, {
        headers,
        data: { tripId, name: 'OldHotel', checkInDate: day1, checkOutDate: day2 },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: lodgingId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await openTab(page, 'lodging');

      await page.getByTestId(`lodging-edit-${lodgingId}`).click();
      await expect(page.getByTestId('lodging-editor-dialog')).toBeVisible();

      const nameInput = page.getByPlaceholder(/name|hotel/i).first();
      await nameInput.fill('NewHotel');
      await page.getByText('Save').click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('NewHotel')).toBeVisible({ timeout: 8000 });
    });

    test('deletes lodging with confirmation', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const createRes = await page.request.post(`${API_BASE}/api/lodgings`, {
        headers,
        data: { tripId, name: 'DeleteHotel', checkInDate: day1, checkOutDate: day2 },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: lodgingId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await openTab(page, 'lodging');

      await page.getByTestId(`lodging-delete-${lodgingId}`).click();
      // ConfirmDialog should appear
      await expect(page.getByTestId('delete-lodging-dialog')).toBeVisible();
      await page.getByText('Confirm').click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId(`lodging-row-${lodgingId}`)).not.toBeVisible({ timeout: 6000 });
    });
  });

  // -------------------------------------------------------------------------
  // Activities
  // -------------------------------------------------------------------------
  test.describe('Activities', () => {
    test('adds an activity via the modal', async ({ page }) => {
      await openTab(page, 'tours');
      await page.getByTestId('activity-add').click();
      await expect(page.getByTestId('activity-form-modal')).toBeVisible();

      await page.getByPlaceholder(/name|title|activity/i).first().fill('Museum Tour');
      await page.getByTestId('activity-save').click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Museum Tour')).toBeVisible({ timeout: 8000 });
    });

    test('edits an activity', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const createRes = await page.request.post(`${API_BASE}/api/activities`, {
        headers,
        data: { tripId, name: 'OldActivity', date: day1 },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: activityId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await openTab(page, 'tours');

      await page.getByTestId(`activity-details-${activityId}`).click();
      await page.getByTestId(`activity-details-edit-${activityId}`).click();
      await expect(page.getByTestId('activity-form-modal')).toBeVisible();
      const nameInput = page.getByPlaceholder(/name|title|activity/i).first();
      await nameInput.fill('UpdatedActivity');
      await page.getByTestId('activity-save').click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('UpdatedActivity')).toBeVisible({ timeout: 8000 });
    });

    test('deletes an activity', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const createRes = await page.request.post(`${API_BASE}/api/activities`, {
        headers,
        data: { tripId, name: 'ToDelete', date: day1 },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: activityId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await openTab(page, 'tours');

      await page.getByTestId(`activity-details-${activityId}`).click();
      await page.getByTestId(`activity-details-delete-${activityId}`).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId(`activity-row-${activityId}`)).not.toBeVisible({ timeout: 6000 });
    });
  });

  // -------------------------------------------------------------------------
  // Car Rentals
  // -------------------------------------------------------------------------
  test.describe('Car Rentals', () => {
    test('adds a car rental via the modal form', async ({ page }) => {
      await openTab(page, 'car');
      await page.getByTestId('car-rental-add').click();
      await expect(page.getByTestId('car-rental-editor-dialog')).toBeVisible();
      await page.getByPlaceholder('Pick up location').fill('LAX Airport');
      await page.getByPlaceholder('Drop off location').fill('Downtown LA');
      await page.getByTestId('car-rental-save').click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('LAX Airport')).toBeVisible({ timeout: 8000 });
    });

    test('deletes a car rental', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const createRes = await page.request.post(`${API_BASE}/api/car-rentals`, {
        headers,
        data: { tripId, pickupLocation: 'SFO', dropoffLocation: 'Oakland', pickupDate: day1 },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: rentalId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await openTab(page, 'car');

      await page.getByTestId(`car-rental-delete-${rentalId}`).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('SFO')).not.toBeVisible({ timeout: 6000 });
    });
  });

  // -------------------------------------------------------------------------
  // Daily Expenses
  // -------------------------------------------------------------------------
  // Daily Expenses is now gated behind the `cost_tracking` tier entitlement
  // (see server/src/routes/accountRoutes.ts) — free-tier users (what
  // loginAsNewUser creates) are correctly blocked from saving expenses.
  // There is no e2e fixture yet to grant a test user premium tier, so these
  // are skipped rather than left as an unexplained failure.
  test.describe('Daily Expenses', () => {
    test.skip('adds a daily expense and it appears in the grid', async ({ page }) => {
      await openTab(page, 'expenses');
      await page.getByTestId('expense-add-button').click();
      await expect(page.getByTestId('expense-add-modal')).toBeVisible();

      // Fill the date field (web input type=date)
      await page.locator('input[type="date"]').first().fill(day1);
      // Fill amount
      await page.getByPlaceholder(/amount/i).first().fill('50');
      await page.getByPlaceholder(/description|note/i).first().fill('Lunch');
      await page.getByTestId('expense-save').click();
      await page.waitForLoadState('networkidle');

      // The expense-cell for day1 should now have a value
      await expect(page.locator(`[data-testid^="expense-cell-${day1}"]`)).toBeVisible({ timeout: 8000 });
    });

    test.skip('views expense detail and deletes an expense', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const createRes = await page.request.post(`${API_BASE}/api/expenses`, {
        headers,
        data: {
          tripId,
          expenseDate: day1,
          amount: 75,
          category: 'Dinner',
          description: 'Dinner',
          currency: 'USD',
        },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: expenseId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await openTab(page, 'expenses');

      // Click the cell to open detail modal
      await page.getByTestId(`expense-cell-${day1}-Dinner`).click();
      await expect(page.getByTestId('expense-detail-modal')).toBeVisible();

      // Delete the expense
      await page.getByTestId(`expense-delete-${expenseId}`).click();
      // Confirm dialog (if shown)
      const confirmBtn = page.getByText('Confirm');
      if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await confirmBtn.click();
      }
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId(`expense-delete-${expenseId}`)).not.toBeVisible({ timeout: 6000 });
    });
  });
});
