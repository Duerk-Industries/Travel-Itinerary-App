/** @jest-environment node */
import { ScreenCache } from '../cache/screenCache';
import { screenFetch } from '../cache/screenFetch';
import { registerScreenSession } from '../cache/screenSession';
import { httpCachePolicy } from '../cache/httpCachePolicy';
import { isCurrentHttpView } from '../cache/httpViews';
import * as storage from '../cache/screenCacheStorage';

jest.mock('../cache/screenCacheStorage', () => ({ read: jest.fn(async () => null), write: jest.fn(async () => undefined), remove: jest.fn(async () => undefined) }));
const endpoint = 'https://test.example/api/activities?tripId=trip-a';
const auth = { Authorization: 'Bearer session-a' };
const clients: ScreenCache[] = []; const cleanups: Array<() => void> = [];
const session = (userId = 'alex', environment = 'https://test.example', token = 'session-a') => {
  const cache = new ScreenCache({ userId, environment }); cache.start(); clients.push(cache);
  cleanups.push(registerScreenSession(cache, token)); return cache;
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { global.fetch = jest.fn(); jest.clearAllMocks(); });
afterEach(async () => { cleanups.splice(0).forEach(cleanup => cleanup()); await Promise.all(clients.splice(0).map(cache => cache.erase())); });

it('shows cached content before a fresh request and deduplicates simultaneous requests', async () => {
  session(); const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json([{ id: 'old' }]));
  await screenFetch(endpoint, { headers: auth });
  let resolve!: (response: Response) => void;
  network.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  const preview = jest.fn();
  const one = screenFetch(endpoint, { headers: auth, onCached: preview });
  const two = screenFetch(endpoint, { headers: auth });
  await new Promise(done => setTimeout(done, 0));
  expect(preview).toHaveBeenCalledWith([{ id: 'old' }]);
  expect(network).toHaveBeenCalledTimes(2);
  resolve(json([{ id: 'fresh' }]));
  expect(await (await one).json()).toEqual([{ id: 'fresh' }]);
  expect(await (await two).json()).toEqual([{ id: 'fresh' }]);
});

it('retains last confirmed data on network/server failures but never on rejected access', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json([{ id: 'saved' }])).mockResolvedValueOnce(json({ error: 'Unavailable' }, 503)).mockResolvedValueOnce(json({ error: 'Forbidden' }, 403));
  await screenFetch(endpoint, { headers: auth });
  const stale = await screenFetch(endpoint, { headers: auth });
  expect(stale.headers.get('X-WanderBunnies-Cache')).toBe('stale');
  expect(await stale.json()).toEqual([{ id: 'saved' }]);
  const denied = await screenFetch(endpoint, { headers: auth });
  expect(denied.status).toBe(403);
  expect(cache.client.getQueryData(['http', '/api/activities?tripId=trip-a'])).toBeUndefined();
  await new Promise(done => setTimeout(done, 0));
  expect(storage.remove).toHaveBeenCalled();
});

it('does not persist or return cached entitlements, billing, bank imports, permissions or admin reports', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  for (const path of ['/api/account', '/api/billing/status', '/api/plaid/candidates', '/api/admin/users', '/api/groups/g/members', '/api/trips/t/planning-capabilities']) {
    expect(httpCachePolicy(path)?.cachedView ?? false).toBe(false);
    network.mockResolvedValueOnce(json({ version: 1 })).mockResolvedValueOnce(json({ version: 2 }));
    const preview = jest.fn();
    await screenFetch(`https://test.example${path}`, { headers: auth });
    expect(await (await screenFetch(`https://test.example${path}`, { headers: auth, onCached: preview })).json()).toEqual({ version: 2 });
    expect(preview).not.toHaveBeenCalled();
  }
  cache.persist(); await new Promise(done => setTimeout(done, 0));
  const snapshot = JSON.parse((storage.write as jest.Mock).mock.calls.slice(-1)[0][1]);
  expect(snapshot.state.queries).toEqual([]);
});

it('invalidates trip and financial dependencies after a write and never restores pre-save data', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  const expenseUrl = 'https://test.example/api/expenses?tripId=trip-a';
  network.mockResolvedValueOnce(json([{ id: 'booking-old' }])).mockResolvedValueOnce(json([{ id: 'expense-old' }])).mockResolvedValueOnce(json({ id: 'saved' })).mockResolvedValueOnce(json([{ id: 'booking-new' }]));
  await screenFetch(endpoint, { headers: auth }); await screenFetch(expenseUrl, { headers: auth });
  await screenFetch('https://test.example/api/expenses', { headers: auth, method: 'POST', body: '{}' });
  expect(cache.client.getQueryState(['http', '/api/activities?tripId=trip-a'])?.isInvalidated).toBe(true);
  cache.persist(); await new Promise(done => setTimeout(done, 0));
  expect((storage.write as jest.Mock).mock.calls.slice(-1)[0][1]).not.toContain('expense-old');
  const preview = jest.fn();
  expect(await (await screenFetch(endpoint, { headers: auth, onCached: preview })).json()).toEqual([{ id: 'booking-new' }]);
  expect(preview).not.toHaveBeenCalled();
});

it('updates the current view on background refresh without applying data to a navigated-away view', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json([{ id: 'first' }])).mockResolvedValueOnce(json([{ id: 'second' }])).mockResolvedValueOnce(json([{ id: 'third' }]));
  let active = true; const view = jest.fn();
  await screenFetch(endpoint, { headers: auth, onCached: view, isCurrent: () => active });
  expect(view).not.toHaveBeenCalled(); // caller applies its own first response once
  await cache.client.refetchQueries({ predicate: query => isCurrentHttpView(cache, query) });
  expect(view).toHaveBeenLastCalledWith([{ id: 'second' }]);
  active = false; view.mockClear();
  await cache.client.refetchQueries({ queryKey: ['http'] });
  expect(view).not.toHaveBeenCalled();
});

it('does not leak cached data across accounts, environments or trip IDs', async () => {
  session(); session('sam', 'https://test.example', 'session-b'); session('alex', 'https://prod.example', 'session-a');
  const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json(['alex-trip-a'])).mockResolvedValueOnce(json(['sam-trip-a'])).mockResolvedValueOnce(json(['alex-prod'])).mockResolvedValueOnce(json(['alex-trip-b']));
  await screenFetch(endpoint, { headers: auth });
  const preview = jest.fn();
  expect(await (await screenFetch(endpoint, { headers: { Authorization: 'Bearer session-b' }, onCached: preview })).json()).toEqual(['sam-trip-a']);
  expect(await (await screenFetch(endpoint.replace('test.example', 'prod.example'), { headers: auth, onCached: preview })).json()).toEqual(['alex-prod']);
  expect(await (await screenFetch(endpoint.replace('trip-a', 'trip-b'), { headers: auth, onCached: preview })).json()).toEqual(['alex-trip-b']);
  expect(preview).not.toHaveBeenCalled();
});

it('one caller aborting does not cancel a deduplicated read needed by another view', async () => {
  session(); let finish!: (response: Response) => void;
  (global.fetch as jest.Mock).mockImplementation(() => new Promise<Response>(done => { finish = done; }));
  const controller = new AbortController();
  const one = screenFetch(endpoint, { headers: auth, signal: controller.signal });
  const two = screenFetch(endpoint, { headers: auth });
  const aborted = expect(one).rejects.toMatchObject({ name: 'AbortError' });
  await new Promise(done => setTimeout(done, 0)); controller.abort(); await aborted;
  finish(json(['still-current']));
  expect(await (await two).json()).toEqual(['still-current']);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('a mutation cancels an old read so it cannot overwrite the next result', async () => {
  const cache = session(); let finish!: (response: Response) => void;
  const network = global.fetch as jest.Mock;
  network.mockImplementationOnce(() => new Promise<Response>(done => { finish = done; })).mockResolvedValueOnce(json({ id: 'saved' })).mockResolvedValueOnce(json(['fresh']));
  const old = screenFetch(endpoint, { headers: auth });
  const cancelled = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  await new Promise(done => setTimeout(done, 0));
  await screenFetch('https://test.example/api/activities', { headers: auth, method: 'POST', body: '{}' });
  finish(json(['stale'])); await cancelled;
  expect(await (await screenFetch(endpoint, { headers: auth })).json()).toEqual(['fresh']);
  expect(cache.client.getQueryData(['http', '/api/activities?tripId=trip-a'])).toEqual(['fresh']);
});

it('works alongside the permission interceptor without recursively wrapping the raw network', async () => {
  const { installPermissionDeniedInterceptor } = await import('../utils/permissionDeniedInterceptor');
  session();
  const network = jest.fn(async () => json([{ id: 'ready' }]));
  global.fetch = network;
  installPermissionDeniedInterceptor();
  expect(await (await screenFetch(endpoint, { headers: auth })).json()).toEqual([{ id: 'ready' }]);
  expect(network).toHaveBeenCalledTimes(1);
});

it('does not invalidate trip data for read-only POST provider operations', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json([{ id: 'saved' }])).mockResolvedValueOnce(json({ images: [] }));
  await screenFetch(endpoint, { headers: auth });
  await screenFetch('https://test.example/api/itinerary/images/batch', { headers: auth, method: 'POST', body: '{}' });
  expect(cache.client.getQueryState(['http', '/api/activities?tripId=trip-a'])?.isInvalidated).toBe(false);
});

it('does not replace a valid saved list with a malformed successful response', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json([{ id: 'valid' }])).mockResolvedValueOnce(json({ unexpected: true }));
  await screenFetch(endpoint, { headers: auth });
  expect(await (await screenFetch(endpoint, { headers: auth })).json()).toEqual([{ id: 'valid' }]);
  expect(cache.client.getQueryData(['http', '/api/activities?tripId=trip-a'])).toEqual([{ id: 'valid' }]);
});

it('removes a cached object view when access is rejected during a background refresh', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  const url = 'https://test.example/api/trips/trip-a/blog';
  network.mockResolvedValueOnce(json({ days: [], title: 'Private title' })).mockResolvedValueOnce(json({ error: 'Forbidden' }, 403));
  const unavailable = jest.fn();
  await screenFetch(url, { headers: auth, onCached: jest.fn(), onUnavailable: unavailable });
  await cache.client.refetchQueries({ queryKey: ['http'] });
  expect(unavailable).toHaveBeenCalledTimes(1);
  expect(cache.client.getQueryData(['http', '/api/trips/trip-a/blog'])).toBeNull();
  await new Promise(done => setTimeout(done, 0));
  expect(storage.remove).toHaveBeenCalled();
});

it('keeps nested editing pauses balanced and resumes reads only after the last form closes', async () => {
  const { subscribeScreenReadResume } = await import('../cache/screenSession');
  const cache = session(); const resumed = jest.fn();
  const unsubscribe = subscribeScreenReadResume('https://test.example', 'session-a', resumed);
  const outer = cache.pauseReads(); const inner = cache.pauseReads();
  outer(); await Promise.resolve();
  expect(cache.readsPaused).toBe(true); expect(resumed).not.toHaveBeenCalled();
  inner(); await Promise.resolve();
  expect(cache.readsPaused).toBe(false); expect(resumed).toHaveBeenCalledTimes(1);
  inner(); await Promise.resolve(); expect(resumed).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it('does not replace an editing view when an earlier background read completes', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json([{ id: 'initial' }])).mockResolvedValueOnce(json([{ id: 'changed' }]));
  const apply = jest.fn();
  await screenFetch(endpoint, { headers: auth, onCached: apply });
  const close = cache.pauseReads();
  await cache.client.refetchQueries({ queryKey: ['http'] });
  expect(apply).not.toHaveBeenCalled();
  expect(cache.client.getQueryData(['http', '/api/activities?tripId=trip-a'])).toEqual([{ id: 'changed' }]);
  close();
});

it('no-store reads never downgrade an explicit offline download to a stale screen result', async () => {
  session(); const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json([{ id: 'old' }])).mockResolvedValueOnce(json({ error: 'Unavailable' }, 503));
  await screenFetch(endpoint, { headers: auth });
  const preview = jest.fn();
  const response = await screenFetch(endpoint, { headers: auth, cache: 'no-store', onCached: preview });
  expect(response.status).toBe(503); expect(preview).not.toHaveBeenCalled();
});

it('access rejection still clears a view while another dialog pauses ordinary refreshes', async () => {
  const cache = session(); const network = global.fetch as jest.Mock;
  network.mockResolvedValueOnce(json([{ id: 'private' }])).mockResolvedValueOnce(json({ error: 'Forbidden' }, 403));
  const unavailable = jest.fn();
  await screenFetch(endpoint, { headers: auth, onCached: jest.fn(), isCurrent: () => true, onUnavailable: unavailable });
  const close = cache.pauseReads();
  await cache.client.refetchQueries({ queryKey: ['http'] });
  expect(unavailable).toHaveBeenCalledTimes(1);
  expect(cache.client.getQueryData(['http', '/api/activities?tripId=trip-a'])).toBeNull();
  close();
});
