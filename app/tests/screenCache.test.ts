import { ScreenCache, clearScreenCache, screenCacheKey, screenQueryKey, CACHE_MAX_AGE_MS } from '../cache/screenCache';
import * as storage from '../cache/screenCacheStorage';

jest.mock('../cache/screenCacheStorage', () => {
  const values = new Map<string, string>();
  return { read: jest.fn(async (key: string) => values.get(key) ?? null),
    write: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    remove: jest.fn(async (key: string) => { values.delete(key); }),
  };
});
const owner = { userId: 'traveler', environment: 'https://test.example' };
const key = screenQueryKey('packing', 'trip-1');
const instances: ScreenCache[] = [];
const create = (scope = owner) => { const cache = new ScreenCache(scope); instances.push(cache); return cache; };
const seed = (cache: ScreenCache, data: unknown, persist = true, updatedAt = Date.now()) => {
  cache.client.setQueryDefaults(key, { meta: { persist } });
  cache.client.setQueryData(key, data, { updatedAt });
};
afterEach(async () => {
  for (const cache of instances.splice(0)) await cache.erase();
  jest.clearAllMocks();
});

test('persists and restores confirmed packing data across screen/client remounts', async () => {
  const cache = create();
  seed(cache, { items: [{ id: 'passport' }] });
  cache.persist(); cache.persist();
  // Wait for persistence queued before this read; erase is intentionally not used on navigation.
  await new Promise(resolve => setTimeout(resolve, 0));
  cache.stop();
  const restored = create(); await restored.restore();
  expect(restored.client.getQueryData(key)).toEqual({ items: [{ id: 'passport' }] });
});

test('separates accounts, environments and trip keys', async () => {
  const cache = create(); seed(cache, { items: ['private'] }); cache.persist();
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const scope of [{ ...owner, userId: 'other' }, { ...owner, environment: 'https://production.example' }]) {
    const other = create(scope); await other.restore();
    expect(other.client.getQueryData(key)).toBeUndefined();
  }
  expect(cache.client.getQueryData(screenQueryKey('packing', 'trip-2'))).toBeUndefined();
});

test('does not restore expired data or persist sensitive views', async () => {
  const cache = create(); seed(cache, ['old'], true, Date.now() - CACHE_MAX_AGE_MS - 1); cache.persist();
  await new Promise(resolve => setTimeout(resolve, 0));
  const restored = create(); await restored.restore();
  expect(restored.client.getQueryData(key)).toBeUndefined();
  cache.client.removeQueries({ queryKey: key });
  seed(cache, ['admin'], false); cache.persist();
  await new Promise(resolve => setTimeout(resolve, 0));
  const report = create(); await report.restore(); expect(report.client.getQueryData(key)).toBeUndefined();
});

test('logout waits for an in-flight storage write before erasing and blocks late persistence', async () => {
  const cache = create(); cache.start();
  let finish!: () => void;
  const write = jest.spyOn(storage, 'write').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  seed(cache, ['private']);
  await Promise.resolve(); await Promise.resolve();
  const cleared = clearScreenCache(owner);
  finish(); await cleared;
  cache.persist(); await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  expect(await storage.read(screenCacheKey(owner))).toBeNull();
  expect(cache.client.getQueryData(key)).toBeUndefined();
  write.mockRestore();
});

test('deduplicates concurrent reads and cancels a response before a newer save', async () => {
  const cache = create();
  let complete!: (data: string[]) => void;
  const fetcher = jest.fn(() => new Promise<string[]>(resolve => { complete = resolve; }));
  const first = cache.client.fetchQuery({ queryKey: key, queryFn: fetcher });
  const second = cache.client.fetchQuery({ queryKey: key, queryFn: fetcher });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const reads = Promise.allSettled([first, second]);
  await cache.client.cancelQueries({ queryKey: key });
  seed(cache, ['saved']); complete(['stale']); await reads;
  expect(cache.client.getQueryData(key)).toEqual(['saved']);
});
