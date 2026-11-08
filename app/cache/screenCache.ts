import { QueryClient, dehydrate, hydrate, type QueryKey } from '@tanstack/react-query';
import * as storage from './screenCacheStorage';

export type CacheOwner = { userId: string; environment: string };
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const cachePolicies = {
  trip: { staleTime: 30_000, persist: true },
  reference: { staleTime: 60 * 60_000, persist: true },
  sensitive: { staleTime: 0, persist: false },
} as const;
export const screenCacheKey = (owner: CacheOwner) =>
  `wb.screen-cache.v1.${encodeURIComponent(owner.environment.replace(/\/$/, ''))}.${encodeURIComponent(owner.userId)}`;
export const screenQueryKey = (resource: string, id?: string | null): QueryKey => [resource, id ?? 'account'];

let nextSessionId = 0;
const live = new Map<string, Set<ScreenCache>>();

/** One client per authenticated account/environment session. No credentials are persisted. */
export class ScreenCache {
  readonly sessionId = ++nextSessionId;
  readonly client = new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: 30_000, gcTime: Infinity, refetchOnMount: 'always',
    refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
  } } });
  readonly key: string;
  private active = true;
  get isActive(): boolean { return this.active; }
  private serial: Promise<unknown> = Promise.resolve();
  private unsubscribe?: () => void;
  constructor(readonly owner: CacheOwner) {
    this.key = screenCacheKey(owner);
  }
  async restore(): Promise<void> {
    try {
      const raw = await storage.read(this.key);
      if (!this.active || !raw || raw.length > 2_000_000) return;
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || saved.owner !== this.key || !Array.isArray(saved.state?.queries)) return;
      const now = Date.now();
      // Hydration never restores mutations or trusts expired/future-dated entries.
      hydrate(this.client, { mutations: [], queries: saved.state.queries.filter((query: { state?: { dataUpdatedAt?: number }; meta?: { persist?: boolean } }) => {
        const time = query.state?.dataUpdatedAt;
        return query.meta?.persist === true && typeof time === 'number' && time <= now && now - time < CACHE_MAX_AGE_MS;
      }).slice(0, 40) });
    } catch { /* A read cache is disposable; storage failure must not block online loading. */ }
  }
  start(): void {
    this.active = true;
    const clients = live.get(this.key) ?? new Set<ScreenCache>();
    clients.add(this); live.set(this.key, clients);
    this.unsubscribe?.();
    this.unsubscribe = this.client.getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'success') {
        // Bound inactive memory entries without per-query timers surviving account teardown.
        const queries = this.client.getQueryCache().getAll();
        const excess = queries.length - 80;
        if (excess > 0) for (const query of queries.filter(query => !query.isActive())
          .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt).slice(0, excess)) {
          this.client.removeQueries({ queryKey: query.queryKey, exact: true });
        }
        this.persist();
      }
    });
  }
  persist(): void {
    if (!this.active) return;
    const state = dehydrate(this.client, { shouldDehydrateQuery: query =>
      query.meta?.persist === true && query.state.status === 'success' && query.state.data != null &&
      Date.now() - query.state.dataUpdatedAt < CACHE_MAX_AGE_MS,
      shouldDehydrateMutation: () => false,
    });
    state.queries = state.queries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt).slice(0, 40);
    let raw: string;
    try { raw = JSON.stringify({ version: 1, owner: this.key, state }); }
    catch { return; }
    if (raw.length > 2_000_000) return;
    this.serial = this.serial.catch(() => undefined).then(() => this.active ? storage.write(this.key, raw) : undefined).catch(() => undefined);
  }
  discardPersisted(): void {
    // Remove the previous disk copy even if a replacement snapshot cannot be serialized.
    this.serial = this.serial.catch(() => undefined).then(() => storage.remove(this.key)).catch(() => undefined);
  }
  stop(): void {
    this.active = false;
    this.unsubscribe?.();
    this.client.clear();
    live.get(this.key)?.delete(this);
    if (!live.get(this.key)?.size) live.delete(this.key);
  }
  async erase(): Promise<void> {
    this.stop();
    await this.serial.catch(() => undefined);
    await storage.remove(this.key);
  }
}

export const clearScreenCache = async (owner: CacheOwner): Promise<void> => {
  const key = screenCacheKey(owner);
  const instances = [...(live.get(key) ?? [])];
  if (instances.length) await Promise.all(instances.map(instance => instance.erase()));
  else await storage.remove(key);
};
