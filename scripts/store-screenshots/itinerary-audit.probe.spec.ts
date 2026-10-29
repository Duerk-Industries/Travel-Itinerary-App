// Temporary audit: itinerary screens at iPhone width, light + dark, with an overflow report.
import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { API_BASE } from '../../app/e2e/fixtures';
import { createDemoTrip, goToTile, iso } from './demoTrip';

const OUT = path.join(__dirname, 'output', 'audit');

const PLAN: Array<Array<[string, string, number]>> = [
  [['14:00', 'Check in to our Alfama apartment', 0], ['16:00', 'Wander Alfama + Miradouro de Santa Luzia', 0], ['20:00', 'Dinner at Time Out Market', 160]],
  [['09:00', 'Pastéis de Belém for breakfast', 40], ['10:30', 'Belém Tower + Jerónimos Monastery', 120], ['15:00', 'Ride Tram 28 through the old town', 15], ['21:00', 'Fado night dinner', 210]],
  [['08:30', 'Train to Sintra', 36], ['10:00', 'Pena Palace', 156], ['13:30', 'Lunch in Sintra village', 64], ['16:00', 'Quinta da Regaleira', 50]],
  [['10:00', 'LX Factory market', 0], ['13:00', 'Seafood lunch at Cervejaria Ramiro', 120], ['19:30', 'Sunset rooftop drinks, Bairro Alto', 80]],
  [['09:00', 'Last coffee + pastries', 30], ['12:00', 'Taxi to airport', 52]],
];

const report = async (page: Page, label: string) => {
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  const sideScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`--- ${label}: page scrolls sideways by ${sideScroll}px`);
  const offenders = await page.evaluate((viewport) => {
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el: el as HTMLElement, r: (el as HTMLElement).getBoundingClientRect() }))
      .filter(({ el, r }) => {
        if (!(r.width > 0 && r.right > viewport + 1) || el.closest('[data-testid="overview-day-bar-scroll"]')) return false;
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (getComputedStyle(a).overflowX === 'hidden' && a.getBoundingClientRect().right <= viewport + 1) return false;
        }
        return true;
      })
      .map(({ el, r }) => `${el.tagName} tid=${el.dataset.testid ?? el.closest('[data-testid]')?.getAttribute('data-testid') ?? ''} right=${Math.round(r.right)} text="${(el.innerText || '').slice(0, 40).replace(/\s+/g, ' ')}"`)
      .filter((line) => (seen.has(line) ? false : (seen.add(line), true)))
      .slice(0, 12);
  }, vw);
  console.log(`\n=== ${label} (viewport ${vw}px): ${offenders.length ? offenders.length + ' overflowing' : 'no overflow'}\n${offenders.join('\n')}`);
};

const shoot = async (page: Page, name: string) => {
  await page.waitForTimeout(1500);
  await page.setViewportSize({ width: 390, height: 2400 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
};

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });

    test(`itinerary audit (${scheme})`, async ({ page }) => {
      const { auth, trip, idOf } = await createDemoTrip(page);
      const all = (['Maya', 'Jordan', 'Priya', 'Sam'] as const).map(idOf);
      const itin = await (await page.request.post(`${API_BASE}/api/itineraries`, { headers: auth, data: { tripId: trip.id, destination: 'Lisbon', days: 5 } })).json();
      for (const [dayIdx, items] of PLAN.entries()) {
        for (const [time, activity, cost] of items) {
          await page.request.post(`${API_BASE}/api/itineraries/${itin.id}/details`, { headers: auth, data: { day: dayIdx + 1, time, activity, cost } });
        }
      }
      await page.request.post(`${API_BASE}/api/lodgings`, { headers: auth, data: { tripId: trip.id, status: 'Booked', name: 'Alfama apartment with river view', checkInDate: iso(0), checkOutDate: iso(4), totalCost: 1180, travelerIds: all, address: 'Rua de São Miguel 12, 1100-544 Lisboa, Portugal' } });
      await page.request.post(`${API_BASE}/api/transfers`, { headers: auth, data: { tripId: trip.id, status: 'Booked', transferType: 'Flight', carrier: 'TAP Air Portugal', flightNumber: 'TP 218', departureDate: iso(0), departureTime: '07:10', departureLocation: 'Newark Liberty International Airport', departureAirportCode: 'EWR', arrivalDate: iso(0), arrivalTime: '18:55', arrivalLocation: 'Humberto Delgado Airport', arrivalAirportCode: 'LIS', cost: 2360, passengerIds: all } });
      await page.request.post(`${API_BASE}/api/activities`, { headers: auth, data: { tripId: trip.id, status: 'Booked', activityType: 'Tour', name: 'Sintra & Cascais full-day small-group tour with hotel pickup', date: iso(2), startTime: '09:00', startLocation: 'Praça do Comércio', duration: '8h', cost: 236, travelerIds: all } });

      if (process.env.NO_PHOTOS) {
        await page.route('**/api/itinerary/images/batch', (route) => route.fulfill({ json: { images: [] } }));
        await page.route('**/api/itinerary/images?*', (route) => route.fulfill({ json: { url: null } }));
      }
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.getByLabel('Home', { exact: true }).click({ timeout: 60_000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT, `${scheme}-0-home.png`) });
      const addTab = page.getByTestId('bottom-tab-add');
      if (await addTab.isVisible().catch(() => false)) {
        await addTab.click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(OUT, `${scheme}-0b-add-sheet.png`) });
        await page.getByTestId('add-sheet-cancel').click();
        await page.waitForTimeout(400);
      }
      await goToTile(page, 'overview');
      await expect(page.getByTestId('overview-day-pill-1')).toBeVisible({ timeout: 30_000 });
      await report(page, `${scheme} · overview`);
      await shoot(page, `${scheme}-1-overview`);

      await page.getByTestId('overview-day-pill-1').click();
      await page.waitForTimeout(1500);
      await report(page, `${scheme} · day 1 detail`);
      await shoot(page, `${scheme}-2-day1`);

      await page.getByTestId('overview-day-pill-3').click();
      await page.waitForTimeout(1500);
      await report(page, `${scheme} · day 3 detail`);
      await shoot(page, `${scheme}-3-day3`);

      const add = page.getByLabel('Add item to this day').first();
      if (await add.isVisible().catch(() => false)) {
        await add.click();
        await page.waitForTimeout(800);
        await report(page, `${scheme} · add item menu`);
        await page.screenshot({ path: path.join(OUT, `${scheme}-4-add-item.png`) });
        await page.getByTestId('add-item-option-cancel').click().catch(() => {});
      }

      await page.getByTestId('overview-day-pill-overview').click();
      await page.waitForTimeout(800);
      const edit = page.getByText('Edit', { exact: true }).first();
      if (await edit.isVisible().catch(() => false)) {
        await edit.click();
        await page.waitForTimeout(1200);
        await report(page, `${scheme} · overview edit mode`);
        await page.getByTestId('overview-trip-date-range').screenshot({ path: path.join(OUT, `${scheme}-6-dates.png`) });
        console.log('DATE-BOX ' + JSON.stringify(await page.evaluate(() => {
          const el = document.querySelector('[data-testid="overview-trip-start-date"]') as HTMLElement | null;
          const out: any[] = [];
          for (let a: HTMLElement | null = el; a && out.length < 6; a = a.parentElement) {
            const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
            out.push({ tag: a.tagName, tid: a.dataset.testid, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), pr: cs.paddingRight, ox: cs.overflowX, mr: cs.marginRight });
          }
          return out;
        })));
        await shoot(page, `${scheme}-5-edit`);
      }
    });
  });
}
