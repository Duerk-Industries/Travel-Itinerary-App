/// <reference types="jest" />
/// <reference types="node" />
describe('TtlCache', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.LOG_FORMAT = 'json';
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.LOG_FORMAT;
    jest.useRealTimers();
  });

  it('returns undefined for a missing key', () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<number>();
    expect(cache.get('x')).toBeUndefined();
  });

  it('returns a set value until it expires', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<string>({ defaultTtlMs: 1000 });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');

    jest.advanceTimersByTime(500);
    expect(cache.get('k')).toBe('v');

    jest.advanceTimersByTime(600);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('getOrFetch calls the fetcher exactly once for concurrent callers', async () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<number>({ defaultTtlMs: 60_000 });
    const fetcher = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 7;
    });
    const [a, b, c] = await Promise.all([
      cache.getOrFetch('k', fetcher),
      cache.getOrFetch('k', fetcher),
      cache.getOrFetch('k', fetcher),
    ]);
    expect(a).toBe(7);
    expect(b).toBe(7);
    expect(c).toBe(7);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('getOrFetch serves from cache on subsequent calls without re-fetching', async () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<number>({ defaultTtlMs: 60_000 });
    const fetcher = jest.fn(async () => 42);

    await cache.getOrFetch('k', fetcher);
    await cache.getOrFetch('k', fetcher);
    await cache.getOrFetch('k', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected fetcher (retry allowed)', async () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<number>();
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(9);

    await expect(cache.getOrFetch('k', fetcher)).rejects.toThrow('boom');
    const second = await cache.getOrFetch('k', fetcher);
    expect(second).toBe(9);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('records cache_hit / cache_miss metrics when metricName is configured', async () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const { getMetricCounterSnapshot, resetMetricCountersForTests } = require('../src/metrics');
    resetMetricCountersForTests();
    const cache = createTtlCache<number>({
      defaultTtlMs: 60_000,
      metricName: 'test_cache',
    });
    const fetcher = jest.fn(async () => 1);

    await cache.getOrFetch('a', fetcher); // miss
    await cache.getOrFetch('a', fetcher); // hit

    const snapshot = getMetricCounterSnapshot();
    expect(snapshot.counters['test_cache.cache_miss']).toBe(1);
    expect(snapshot.counters['test_cache.cache_hit']).toBe(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('clear() removes all entries', () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<number>({ defaultTtlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('delete() removes a single entry', () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<number>({ defaultTtlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('respects per-call ttl override in set()', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<number>({ defaultTtlMs: 60_000 });
    cache.set('short', 1, 100);
    cache.set('long', 2, 5_000);
    jest.advanceTimersByTime(200);
    expect(cache.get('short')).toBeUndefined();
    expect(cache.get('long')).toBe(2);
  });

  it('evicts the least-recently-used entry at the entry cap', () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<number>({ maxEntries: 2, defaultTtlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // make a the most recently used key
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('evicts by resident byte budget', () => {
    const { createTtlCache } = require('../src/utils/ttlCache');
    const cache = createTtlCache<string>({
      maxSizeBytes: 5,
      sizeOf: (value: string) => value.length,
      defaultTtlMs: 60_000,
    });
    cache.set('a', '1234');
    cache.set('b', 'xyz');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('xyz');
    expect(cache.sizeBytes()).toBe(3);
  });
});
