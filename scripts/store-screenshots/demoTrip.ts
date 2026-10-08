import { expect, type Page } from '@playwright/test';
import { API_BASE, registerUser } from '../../app/e2e/fixtures';

export const TRAVELERS = ['Maya', 'Jordan', 'Priya', 'Sam'] as const;
export type Traveler = typeof TRAVELERS[number];
export const FULL_NAME: Record<Traveler, string> = { Maya: 'Maya Chen', Jordan: 'Jordan Reyes', Priya: 'Priya Patel', Sam: 'Sam Okafor' };

// The demo trip always runs Oct 29 - Nov 2, 2026.
const TRIP_START = '2026-10-29';
export const iso = (offset: number) => {
  const d = new Date(`${TRIP_START}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const userIdFromToken = (token: string): string => {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return String(payload.userId ?? payload.sub);
};

/**
 * Creates the "Lisbon Long Weekend" demo trip. All four travelers are real accounts: Maya owns
 * the trip and the other three accept their invites, so votes and comments go through the API.
 * The browser is signed in as Maya.
 */
export type DemoUsers = { tokens: Record<Traveler, string>; userIds: Record<Traveler, string>; emails: Record<Traveler, string> };

// Pass `users` from an earlier call to put a second trip on the same four accounts, so each
// traveler keeps the same avatar color across screenshots (colors derive from the account id).
export async function createDemoTrip(page: Page, tripName = 'Lisbon Long Weekend', users?: DemoUsers) {
  const tokens = { ...(users?.tokens ?? {}) } as Record<Traveler, string>;
  const userIds = { ...(users?.userIds ?? {}) } as Record<Traveler, string>;
  const emails = { ...(users?.emails ?? {}) } as Record<Traveler, string>;
  for (const t of users ? [] : TRAVELERS) {
    const [firstName, lastName] = FULL_NAME[t].split(' ');
    const creds = await registerUser(page.request, { firstName, lastName });
    const login = await (await page.request.post(`${API_BASE}/api/web-auth/login`, { data: { email: creds.email, password: creds.password } })).json();
    tokens[t] = String(login.token);
    userIds[t] = userIdFromToken(tokens[t]);
    emails[t] = creds.email;
  }
  const authOf = (t: Traveler) => ({ Authorization: `Bearer ${tokens[t]}` });
  const auth = authOf('Maya');

  const tripRes = await page.request.post(`${API_BASE}/api/trips/wizard`, {
    headers: auth,
    data: {
      name: tripName,
      startDate: iso(0),
      endDate: iso(4),
      currency: 'USD',
      participants: (['Jordan', 'Priya', 'Sam'] as Traveler[]).map((t) => {
        const [firstName, lastName] = FULL_NAME[t].split(' ');
        return { firstName, lastName, email: emails[t] };
      }),
    },
  });
  expect(tripRes.ok(), await tripRes.text()).toBeTruthy();
  const { trip } = await tripRes.json();

  for (const t of ['Jordan', 'Priya', 'Sam'] as Traveler[]) {
    const invites = await (await page.request.get(`${API_BASE}/api/groups/invites`, { headers: authOf(t) })).json();
    for (const invite of invites ?? []) {
      const r = await page.request.post(`${API_BASE}/api/groups/invites/${invite.id}/accept`, { headers: authOf(t) });
      expect(r.ok(), await r.text()).toBeTruthy();
    }
  }

  const members = await (await page.request.get(`${API_BASE}/api/account/trips/${trip.id}/members`, { headers: auth })).json();
  const idOf = (t: Traveler) => {
    const m = members.find((x: any) => String(x.userId ?? '') === userIds[t]);
    if (!m) throw new Error(`member ${t} not found: ${JSON.stringify(members)}`);
    return String(m.id);
  };

  // pg-mem returns trip dates as full timestamps; the app expects YYYY-MM-DD.
  const trimDates = (v: any): any => {
    if (Array.isArray(v)) return v.map(trimDates);
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if ((k === 'startDate' || k === 'endDate') && typeof v[k] === 'string') v[k] = v[k].slice(0, 10);
        else v[k] = trimDates(v[k]);
      }
    }
    return v;
  };
  await page.route('**/api/trips**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const text = await res.text();
    try { await route.fulfill({ response: res, json: trimDates(JSON.parse(text)) }); }
    catch { await route.fulfill({ response: res, body: text }); }
  });

  await page.addInitScript(([token, email, tripId]) => {
    window.localStorage.setItem('stp.session', JSON.stringify({
      token, name: 'Maya Chen', email, role: 'user', page: 'home', pageHistory: [], tripId, expiresAt: Date.now() + 3600000,
    }));
    window.localStorage.setItem('stp.session.token', token);
    const css = '[aria-label="Open the app guide assistant"]{display:none!important}';
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el);
    });
  }, [tokens.Maya, emails.Maya, trip.id]);

  return { trip, auth, authOf, tokens, userIds, idOf, members, users: { tokens, userIds, emails } as DemoUsers };
}

export async function goToTile(page: Page, tile: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByLabel('Home', { exact: true }).click({ timeout: 30_000 });
  await page.getByTestId(`home-nav-${tile}`).click({ timeout: 30_000 });
}

/** Hides elements for the screenshot (crop-equivalent), by testID: exact, prefix ("x*") or suffix ("*x"). */
export async function hide(page: Page, testIds: string[]) {
  const css = testIds
    .map((id) => (id.endsWith('*')
      ? `[data-testid^="${id.slice(0, -1)}"]`
      : id.startsWith('*') ? `[data-testid$="${id.slice(1)}"]` : `[data-testid="${id}"]`))
    .join(',') + '{display:none!important}';
  await page.addStyleTag({ content: css });
}

export async function shoot(page: Page, file: string) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  // The app scrolls inside its own container, so grow the viewport to render everything.
  await page.setViewportSize({ width: 430, height: 2200 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: file });
  await page.setViewportSize({ width: 430, height: 932 });
}
