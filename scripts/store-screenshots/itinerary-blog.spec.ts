/**
 * App Store screenshots for the shared itinerary, the trip blog and voting on plans.
 * Run: SPEC=itinerary-blog.spec.ts npx playwright test -c scripts/store-screenshots/playwright.config.ts
 * Photos come from the Unsplash API (credits written to output/photo-credits.txt).
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { API_BASE } from '../../app/e2e/fixtures';
import { createDemoTrip, goToTile, hide, iso, shoot, FULL_NAME, TRAVELERS, type Traveler } from './demoTrip';
import { captureVotes } from './votes';

const OUT = path.join(__dirname, 'output');
// Lisbon time (UTC+0 at the end of October), so comment times read as local trip times.
test.use({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: 'Europe/Lisbon' });

const PLAN: Array<Array<[string, string, number]>> = [
  [['14:00', 'Check in to our Alfama apartment', 0], ['16:00', 'Wander Alfama + Miradouro de Santa Luzia', 0], ['20:00', 'Dinner at Time Out Market', 160]],
  [['09:00', 'Pastéis de Belém for breakfast', 40], ['10:30', 'Belém Tower + Jerónimos Monastery', 120], ['15:00', 'Ride Tram 28 through the old town', 15], ['21:00', 'Fado night dinner', 210]],
  [['08:30', 'Train to Sintra', 36], ['10:00', 'Pena Palace', 156], ['13:30', 'Lunch in Sintra village', 64], ['16:00', 'Quinta da Regaleira', 50]],
  [['10:00', 'LX Factory market', 0], ['13:00', 'Seafood lunch at Cervejaria Ramiro', 120], ['19:30', 'Sunset rooftop drinks, Bairro Alto', 80]],
  [['09:00', 'Last coffee + pastries', 30], ['12:00', 'Taxi to airport', 52]],
];

const PHOTO_QUERIES = [
  'Alfama Lisbon rooftops', 'Lisbon yellow tram 28', 'Belem Tower Lisbon', 'pasteis de nata',
  'Pena Palace Sintra', 'Lisbon miradouro view', 'Lisbon street azulejo tiles', 'Lisbon sunset river',
];

const BLOG_DAYS = [
  { headline: 'Hello, Lisbon!', body: 'We dropped our bags in Alfama and got happily lost in the steep little streets. Jordan found the best viewpoint in town by accident. Dinner at Time Out Market was a feast.' },
  { headline: 'Trams, tarts & fado', body: 'Six pastéis de nata before 10am (no regrets). Rode the old yellow Tram 28 up the hills, then ended the night with fado. Priya cried, Sam pretended not to.' },
  { headline: 'A fairytale day in Sintra', body: 'Pena Palace looks like it was painted with every crayon in the box. Worth every step of the climb. Lunch in the village, then the spiral well at Quinta da Regaleira.' },
];

test('itinerary, blog and voting screenshots', async ({ page }) => {
  const { auth, authOf, trip, userIds, users } = await createDemoTrip(page);

  // Lisbon photos from Unsplash, using the same access key the server uses.
  const unsplashKey = dotenv.parse(fs.readFileSync(path.join(__dirname, '../../server/.env'))).UNSPLASH_ACCESS_KEY;
  expect(unsplashKey, 'UNSPLASH_ACCESS_KEY in server/.env').toBeTruthy();
  const photos: string[] = [];
  const credits: string[] = [];
  for (const q of PHOTO_QUERIES) {
    const r = await page.request.get('https://api.unsplash.com/search/photos', {
      params: { query: q, per_page: 3, orientation: 'landscape', content_filter: 'high' },
      headers: { Authorization: `Client-ID ${unsplashKey}`, 'Accept-Version': 'v1' },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    const hit = (await r.json()).results.find((x: any) => !photos.includes(x.urls.regular));
    if (!hit) continue;
    photos.push(hit.urls.regular);
    credits.push(`${q}: photo by ${hit.user.name} (${hit.user.links.html}) on Unsplash, ${hit.links.html}`);
  }
  fs.writeFileSync(path.join(OUT, 'photo-credits.txt'), credits.join('\n') + '\n');
  expect(photos.length, 'need Lisbon photos').toBeGreaterThan(3);
  const photo = (i: number) => photos[i % photos.length];

  // Itinerary.
  const itin = await (await page.request.post(`${API_BASE}/api/itineraries`, { headers: auth, data: { tripId: trip.id, destination: 'Lisbon', days: 5 } })).json();
  for (const [dayIdx, items] of PLAN.entries()) {
    for (const [time, activity, cost] of items) {
      const r = await page.request.post(`${API_BASE}/api/itineraries/${itin.id}/details`, { headers: auth, data: { day: dayIdx + 1, time, activity, cost } });
      expect(r.ok(), await r.text()).toBeTruthy();
    }
  }
  const dayCover = [0, 2, 4, 6, 7];
  await page.route('**/api/itinerary/images/batch', async (route) => {
    const body = route.request().postDataJSON() as { days: Array<{ date: string; dayIndex?: number }> };
    await route.fulfill({ json: { images: body.days.map((d, i) => ({ date: d.date, url: photo(dayCover[((d.dayIndex ?? i + 1) - 1) % 5]) })) } });
  });

  // Blog: real headlines + posts.
  for (const [i, day] of BLOG_DAYS.entries()) {
    const r = await page.request.post(`${API_BASE}/api/trips/${trip.id}/blog/items`, { headers: auth, data: { dayDate: iso(i), body: day.body, kindKey: 'core.text' } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  const blog = await (await page.request.get(`${API_BASE}/api/trips/${trip.id}/blog`, { headers: auth })).json();
  for (const [i, day] of BLOG_DAYS.entries()) {
    const d = blog.days.find((x: any) => x.localDate === iso(i));
    const r = await page.request.patch(`${API_BASE}/api/trips/${trip.id}/blog/days/${iso(i)}`, { headers: auth, data: { headline: day.headline, updateVersion: d.updateVersion } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }

  // Photo galleries: real media needs cloud storage, so inject them into the blog response.
  const galleryPhotos = [[0, 5, 6, 1], [3, 1, 2, 7], [4, 6, 5, 0]];
  await page.route(`**/api/trips/${trip.id}/blog?*`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch({ headers: { ...route.request().headers(), 'if-none-match': '' } });
    const data = await res.json();
    for (const [i, idxs] of galleryPhotos.entries()) {
      const day = data.days.find((x: any) => x.localDate === iso(i));
      if (!day) continue;
      const assets = idxs.map((p, n) => ({
        id: `demo-asset-${i}-${n}`, assetId: `demo-asset-${i}-${n}`, kindKey: 'media.photo', mediaKind: 'photo', state: 'ready',
        primaryUrl: photo(p), thumbnailUrl: photo(p), dayDate: iso(i), position: n, audience: 'public',
        uploaderUserId: userIds[TRAVELERS[(i + n) % 4]], createdAt: new Date(Date.now() - n * 60000).toISOString(), altText: 'Lisbon trip photo',
        engagement: { reactionCounts: { '❤️': 3 - (n % 3) }, reactionTotal: 3 - (n % 3), commentCount: 0, userReaction: null },
      }));
      day.items.push({
        id: `demo-gallery-${i}`, tripId: trip.id, kindKey: 'core.gallery', schemaVersion: 1, audience: 'public',
        sortKey: `zz-${i}`, authorUserId: userIds.Maya, version: 1, caption: null, dayDate: iso(i),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), assets,
      });
      day.coverItemId = assets[0].id;
      day.coverIsExplicit = true;
      day.contributors = TRAVELERS.map((t, n) => ({ userId: userIds[t], displayName: FULL_NAME[t], itemCount: n === 0 ? 1 : 0, assetCount: 1 }));
      day.engagement = { reactionCounts: { '❤️': 5, '😂': 2 }, reactionTotal: 7, commentCount: 2, userReaction: null };
    }
    await route.fulfill({ response: res, status: 200, json: data });
  });

  // A short, real comment thread on each blog day, posted by the travelers themselves.
  const COMMENTS: Array<Array<[Traveler, string]>> = [
    [['Jordan', 'That viewpoint was a happy accident and I am taking full credit 😎'], ['Priya', 'Best first night ever. Already want to go back.']],
    [['Sam', 'For the record I did NOT cry at fado.'], ['Priya', 'Sam cried. 😂']],
    [['Jordan', 'My legs still hate that hill. Worth it.'], ['Maya', 'The spiral well was unreal!']],
  ];
  for (const [i, thread] of COMMENTS.entries()) {
    const day = blog.days.find((x: any) => x.localDate === iso(i));
    for (const [who, body] of thread) {
      const r = await page.request.post(`${API_BASE}/api/trips/${trip.id}/blog/day/${day.id}/comments`, {
        headers: { ...authOf(who), 'Idempotency-Key': `demo-${i}-${who}-${body.length}` },
        data: { body, parentCommentId: null },
      });
      expect(r.ok(), await r.text()).toBeTruthy();
    }
  }
  // Comments are stamped with today's date; show them during the trip instead
  // (that evening at 9:42 PM, then the next morning at 8:15 AM).
  await page.route(`**/api/trips/${trip.id}/blog/comments?*`, async (route) => {
    const dayDate = new URL(route.request().url()).searchParams.get('dayDate') ?? '';
    const i = COMMENTS.findIndex((_, n) => iso(n) === dayDate);
    const res = await route.fetch();
    const data = await res.json();
    const sorted = [...(data.comments ?? [])].sort((x: any, y: any) => String(x.createdAt).localeCompare(String(y.createdAt)));
    const times = i < 0 ? [] : [`${iso(i)}T21:42:00Z`, `${iso(i + 1)}T08:15:00Z`];
    data.comments = sorted.map((c: any, n: number) => (times[n] ? { ...c, createdAt: times[n], updatedAt: times[n] } : c));
    await route.fulfill({ response: res, json: data });
  });

  await goToTile(page, 'overview');
  await expect(page.getByTestId('overview-traveler-avatars')).toBeVisible({ timeout: 30_000 });
  await shoot(page, path.join(OUT, 'itinerary-full.png'));
  await goToTile(page, 'blog');
  await page.waitForTimeout(3000);
  // On web the read-only post renders in an iframe that doesn't size to its text, leaving a
  // large gap under each post (native sizes it via dynamicHeight). Fit it for the screenshot.
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid^="blog-item-view-"] iframe').forEach((f) => {
      const frame = f as HTMLIFrameElement;
      const pm = frame.contentDocument?.querySelector('.ProseMirror');
      const last = pm?.lastElementChild as HTMLElement | null | undefined;
      const h = last ? last.getBoundingClientRect().bottom + 4 : 0;
      if (!h) return;
      let el: HTMLElement | null = frame;
      for (let n = 0; n < 2 && el; n++, el = el.parentElement) { el.style.height = `${Math.ceil(h)}px`; el.style.minHeight = '0'; }
    });
  });
  await hide(page, ['*-composer']);
  await shoot(page, path.join(OUT, 'blog-full.png'));

  // Voting runs on a second trip with the same four accounts.
  await captureVotes(page, users);
});
