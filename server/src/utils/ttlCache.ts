import { dedupeInFlight } from './inflightDedupe';
import { incrementMetric } from '../metrics';

type Entry<V> = {
  value: V;
  expiresAtMs: number;
  sizeBytes: number;
};

export type TtlCacheOptions<V = unknown> = {
  /** Default TTL applied when a caller doesn't pass one to `set` / `getOrFetch`. */
  defaultTtlMs?: number;
  /**
   * Metric namespace (for `${namespace}.cache_hit` / `${namespace}.cache_miss`).
   * When omitted, no cache metrics are emitted.
   */
  metricName?: string;
  /** Maximum number of resident entries. Entries are evicted least-recently-used first. */
  maxEntries?: number;
  /** Optional resident-byte budget. Requires no special value type; sizeOf defaults to 1. */
  maxSizeBytes?: number;
  /** Returns the approximate resident size of a value for maxSizeBytes accounting. */
  sizeOf?: (value: V) => number;
};

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly dedupeSymbol = Symbol('ttl-cache:dedupe');
  private readonly defaultTtlMs: number;
  private readonly metricName: string | undefined;
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number | undefined;
  private readonly sizeOf: (value: V) => number;
  private totalSizeBytes = 0;

  constructor(options: TtlCacheOptions<V> = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000;
    this.metricName = options.metricName;
    this.maxEntries = Number.isFinite(options.maxEntries) && (options.maxEntries as number) > 0
      ? Math.floor(options.maxEntries as number)
      : 500;
    this.maxSizeBytes = Number.isFinite(options.maxSizeBytes) && (options.maxSizeBytes as number) > 0
      ? Math.floor(options.maxSizeBytes as number)
      : undefined;
    this.sizeOf = options.sizeOf ?? (() => 1);
  }

  private valueSize(value: V): number {
    const size = Number(this.sizeOf(value));
    return Number.isFinite(size) && size > 0 ? size : 1;
  }

  private removeEntry(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.totalSizeBytes = Math.max(0, this.totalSizeBytes - entry.sizeBytes);
    this.store.delete(key);
  }

  private enforceBounds(): void {
    while (
      this.store.size > this.maxEntries ||
      (this.maxSizeBytes !== undefined && this.totalSizeBytes > this.maxSizeBytes)
    ) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.removeEntry(oldestKey);
    }
  }

  /** Read a cached value, removing it if it has expired. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= Date.now()) {
      this.removeEntry(key);
      return undefined;
    }
    // Map insertion order is our LRU order. Touch on reads so hot keys stay.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /** Overwrite the cache entry for `key` with `value` and an expiry. */
  set(key: string, value: V, ttlMs?: number): void {
    const ttl = Math.max(1, ttlMs ?? this.defaultTtlMs);
    this.removeEntry(key);
    const sizeBytes = this.valueSize(value);
    this.store.set(key, { value, expiresAtMs: Date.now() + ttl, sizeBytes });
    this.totalSizeBytes += sizeBytes;
    this.enforceBounds();
  }

  /** Remove a single entry. */
  delete(key: string): void {
    this.removeEntry(key);
  }

  /** Drop all cached entries. */
  clear(): void {
    this.store.clear();
    this.totalSizeBytes = 0;
  }

  size(): number {
    return this.store.size;
  }

  sizeBytes(): number {
    return this.totalSizeBytes;
  }

  /**
   * Fetch-through cache with in-flight dedupe:
   * - Returns the cached value if it exists and hasn't expired.
   * - Otherwise calls `fetcher`; concurrent callers with the same key share
   *   the same promise so `fetcher` fires at most once per key per window.
   * - Stores successful results with the provided TTL (or the cache default).
   * - Does NOT cache errors — failed fetches can be retried immediately.
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<V>,
    ttlMs?: number
  ): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) {
      if (this.metricName) incrementMetric(`${this.metricName}.cache_hit`);
      return cached;
    }
    if (this.metricName) incrementMetric(`${this.metricName}.cache_miss`);
    return dedupeInFlight(
      key,
      async () => {
        // A concurrent caller may have populated the cache between the
        // initial miss and this closure running — re-check before fetching.
        const afterWait = this.get(key);
        if (afterWait !== undefined) return afterWait;
        const value = await fetcher();
        this.set(key, value, ttlMs);
        return value;
      },
      { registry: this.dedupeSymbol }
    );
  }
}

/** Convenience factory for callers who prefer a functional construction style. */
export const createTtlCache = <V>(options?: TtlCacheOptions<V>): TtlCache<V> =>
  new TtlCache<V>(options);
