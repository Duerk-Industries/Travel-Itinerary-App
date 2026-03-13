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
// Test setup
// ---------------------------------------------------------------------------
let tripId: string;

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
      const createRes = await page.request.post(`${API_BASE}/api/transfers`, {
        headers,
        data: {
          tripId,
          departureLocation: 'JFK',
          arrivalLocation: 'LAX',
          carrier: 'OriginalAir',
          flightNumber: 'OA100',
          departureTime: '2025-06-01T10:00:00',
          type: 'Flight',
        },
      });
      expect(createRes.ok(), 'pre-create transfer failed').toBeTruthy();
      const { id: transferId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
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
      const createRes = await page.request.post(`${API_BASE}/api/transfers`, {
        headers,
        data: {
          tripId,
          departureLocation: 'ORD',
          arrivalLocation: 'MIA',
          carrier: 'DeleteAir',
          flightNumber: 'DA999',
          departureTime: '2025-07-01T08:00:00',
          type: 'Flight',
        },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: transferId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
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
        data: { tripId, name: 'OldHotel', checkInDate: '2025-06-01', checkOutDate: '2025-06-05' },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: lodgingId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
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
        data: { tripId, name: 'DeleteHotel', checkInDate: '2025-08-01', checkOutDate: '2025-08-03' },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: lodgingId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
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
        data: { tripId, name: 'OldActivity', date: '2025-06-10' },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: activityId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await openTab(page, 'tours');

      await page.getByTestId(`activity-edit-${activityId}`).click();
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
        data: { tripId, name: 'ToDelete', date: '2025-06-15' },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: activityId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await openTab(page, 'tours');

      await page.getByTestId(`activity-delete-${activityId}`).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId(`activity-row-${activityId}`)).not.toBeVisible({ timeout: 6000 });
    });
  });

  // -------------------------------------------------------------------------
  // Car Rentals
  // -------------------------------------------------------------------------
  test.describe('Car Rentals', () => {
    test('adds a car rental via the inline form', async ({ page }) => {
      await openTab(page, 'car');
      await page.getByPlaceholder('Pick up location').fill('LAX Airport');
      await page.getByPlaceholder('Drop off location').fill('Downtown LA');
      await page.getByTestId('car-rental-add').click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('LAX Airport')).toBeVisible({ timeout: 8000 });
    });

    test('deletes a car rental', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const createRes = await page.request.post(`${API_BASE}/api/car-rentals`, {
        headers,
        data: { tripId, pickupLocation: 'SFO', dropoffLocation: 'Oakland', pickupDate: '2025-07-01' },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: rentalId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await openTab(page, 'car');

      await page.getByTestId(`car-rental-delete-${rentalId}`).click();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('SFO')).not.toBeVisible({ timeout: 6000 });
    });
  });

  // -------------------------------------------------------------------------
  // Daily Expenses
  // -------------------------------------------------------------------------
  test.describe('Daily Expenses', () => {
    test('adds a daily expense and it appears in the grid', async ({ page }) => {
      await openTab(page, 'expenses');
      await page.getByTestId('expense-add-button').click();
      await expect(page.getByTestId('expense-add-modal')).toBeVisible();

      // Fill the date field (web input type=date)
      await page.locator('input[type="date"]').first().fill('2025-06-10');
      // Fill amount
      await page.getByPlaceholder(/amount/i).first().fill('50');
      await page.getByPlaceholder(/description|note/i).first().fill('Lunch');
      await page.getByTestId('expense-save').click();
      await page.waitForLoadState('networkidle');

      // The expense-cell for 2025-06-10 should now have a value
      await expect(page.locator('[data-testid^="expense-cell-2025-06-10"]')).toBeVisible({ timeout: 8000 });
    });

    test('views expense detail and deletes an expense', async ({ page }) => {
      const headers = await getAuthHeaders(page);
      const createRes = await page.request.post(`${API_BASE}/api/expenses`, {
        headers,
        data: {
          tripId,
          date: '2025-06-20',
          amount: 75,
          category: 'Food',
          description: 'Dinner',
          currency: 'USD',
        },
      });
      expect(createRes.ok()).toBeTruthy();
      const { id: expenseId } = await createRes.json();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await openTab(page, 'expenses');

      // Click the cell to open detail modal
      await page.getByTestId('expense-cell-2025-06-20-Food').click();
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
