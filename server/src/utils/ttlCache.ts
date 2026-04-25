import { dedupeInFlight } from './inflightDedupe';
import { incrementMetric } from '../metrics';

type Entry<V> = {
  value: V;
  expiresAtMs: number;
};

export type TtlCacheOptions = {
  /** Default TTL applied when a caller doesn't pass one to `set` / `getOrFetch`. */
  defaultTtlMs?: number;
  /**
   * Metric namespace (for `${namespace}.cache_hit` / `${namespace}.cache_miss`).
   * When omitted, no cache metrics are emitted.
   */
  metricName?: string;
};

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly dedupeSymbol = Symbol('ttl-cache:dedupe');
  private readonly defaultTtlMs: number;
  private readonly metricName: string | undefined;

  constructor(options: TtlCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000;
    this.metricName = options.metricName;
  }

  /** Read a cached value, removing it if it has expired. */
  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Overwrite the cache entry for `key` with `value` and an expiry. */
  set(key: string, value: V, ttlMs?: number): void {
    const ttl = Math.max(1, ttlMs ?? this.defaultTtlMs);
    this.store.set(key, { value, expiresAtMs: Date.now() + ttl });
  }

  /** Remove a single entry. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Drop all cached entries. */
  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
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
export const createTtlCache = <V>(options?: TtlCacheOptions): TtlCache<V> =>
  new TtlCache<V>(options);
