/**
 * App Store screenshots for expense splitting: ledger + bookings, settle-up, daily expenses.
 * Everything is real data through the API (cost tracking is on the free tier).
 * Run: npx playwright test -c scripts/store-screenshots/playwright.config.ts
 * Output: scripts/store-screenshots/output/*-full.png (430px wide at 3x).
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { API_BASE } from '../../app/e2e/fixtures';
import { createDemoTrip, goToTile, hide, iso, shoot } from './demoTrip';

const OUT = path.join(__dirname, 'output');

test.use({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

test('expense splitting screenshots', async ({ page }) => {
  const { auth, trip, idOf } = await createDemoTrip(page);
  const [maya, jordan, priya, sam] = (['Maya', 'Jordan', 'Priya', 'Sam'] as const).map(idOf);
  const all = [maya, jordan, priya, sam];
  const post = async (url: string, data: any) => {
    const r = await page.request.post(`${API_BASE}${url}`, { headers: auth, data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBeTruthy();
    return r.json();
  };

  // Bookings: their costs reach the group tab on their own, no expense entries needed.
  await post('/api/lodgings', {
    tripId: trip.id, status: 'Booked', name: 'Alfama apartment', checkInDate: iso(0), checkOutDate: iso(4),
    rooms: 2, totalCost: 1180, paidBy: [maya], travelerIds: all,
  });
  await post('/api/transfers', {
    tripId: trip.id, status: 'Booked', transferType: 'Flight', carrier: 'TAP Air Portugal', flightNumber: 'TP 218',
    departureDate: iso(0), departureTime: '07:10', departureLocation: 'Newark', departureAirportCode: 'EWR',
    arrivalDate: iso(0), arrivalTime: '18:55', arrivalLocation: 'Lisbon', arrivalAirportCode: 'LIS',
    cost: 2360, passengerIds: all, paidBy: [jordan],
  });
  await post('/api/activities', {
    tripId: trip.id, status: 'Booked', activityType: 'Tour', name: 'Sintra day trip', date: iso(2), startTime: '09:00',
    cost: 236, paidBy: [priya], travelerIds: all,
  });

  const expenses: Array<[number, string, number, string[], string[], string]> = [
    [0, 'Rides', 48.0, [maya], all, 'Airport taxi'],
    [0, 'Dinner', 164.4, [jordan], all, 'Time Out Market'],
    [0, 'Lunch', 58.2, [priya], all, 'Bifanas in Alfama'],
    [1, 'Breakfast', 38.6, [priya], all, 'Pastéis de Belém'],
    [1, 'Lunch', 72.25, [sam], [sam, priya, jordan], 'Seafood at Cervejaria'],
    [1, 'Dinner', 211.8, [maya, jordan], all, 'Fado night dinner'],
    [2, 'Breakfast', 22.5, [maya], all, 'Café da Garagem'],
    [2, 'Rides', 36.0, [jordan], all, 'Train to Sintra'],
    [2, 'Lunch', 64.3, [maya], all, 'Sintra café'],
    [2, 'Souvenirs', 42.0, [sam], [sam], 'Azulejo tiles'],
    [3, 'Breakfast', 29.4, [sam], all, 'Bakery run'],
    [3, 'Lunch', 46.0, [jordan], all, 'LX Factory market'],
    [3, 'Dinner', 188.9, [priya], all, 'Rooftop dinner, Bairro Alto'],
    [3, 'Other Food', 24.0, [jordan], [jordan, maya], 'Ginjinha tasting'],
    [4, 'Breakfast', 27.8, [priya], all, 'Last pastries'],
    [4, 'Rides', 52.0, [sam], all, 'Taxi to airport'],
  ];
  for (const [day, category, amount, payerIds, forIds, vendor] of expenses) {
    await post('/api/expenses', { tripId: trip.id, expenseDate: iso(day), category, amount, currency: 'USD', payerIds, forIds, vendor, notes: vendor });
  }
  // Payments can't be future-dated, so record it today and show it on the trip's last day.
  await post('/api/payments', { tripId: trip.id, payerId: priya, receiverId: maya, paymentDate: new Date().toISOString().slice(0, 10), amountCents: 15000, currency: 'USD' });
  await page.route('**/api/payments?*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const rows = await res.json();
    await route.fulfill({ response: res, json: (Array.isArray(rows) ? rows : []).map((row: any) => ({ ...row, paymentDate: iso(4) })) });
  });

  // 1. Hero: per-person totals plus the costs that came in from bookings. Nothing below that.
  await goToTile(page, 'cost');
  await page.getByText('📒 Ledger').click({ timeout: 30_000 });
  await expect(page.getByTestId('ledger-bookings')).toBeVisible({ timeout: 30_000 });
  await hide(page, ['ledger-settlement', 'ledger-payments', 'expense-covering']);
  await shoot(page, path.join(OUT, 'ledger-full.png'));

  // 2. Settle up, with one covering example (Maya covers Sam).
  const cover = await page.request.put(`${API_BASE}/api/trips/${trip.id}/covered-by`, { headers: auth, data: { [sam]: maya } });
  expect(cover.ok(), await cover.text()).toBeTruthy();
  await goToTile(page, 'cost');
  await page.getByText('📒 Ledger').click({ timeout: 30_000 });
  await expect(page.getByTestId('ledger-settlement')).toBeVisible({ timeout: 30_000 });
  await hide(page, ['ledger-summary', 'ledger-bookings', 'payment-delete-*', 'covering-save']);
  await shoot(page, path.join(OUT, 'settle-full.png'));

  // 6. Daily expenses, without the receipt button or the "Other expenses" section.
  await goToTile(page, 'expenses');
  await expect(page.getByTestId('expense-add-button')).toBeVisible({ timeout: 30_000 });
  await hide(page, ['expense-scan-receipt-button', 'other-expenses']);
  await shoot(page, path.join(OUT, 'expenses-full.png'));
});
