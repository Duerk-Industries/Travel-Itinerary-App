import type { Query, QueryKey } from '@tanstack/react-query';
import type { ScreenCache } from './screenCache';

type View = { apply: (data: unknown) => void; current: () => boolean; unavailable?: () => void; waiting?: boolean };
const dirty = new WeakMap<ScreenCache, Set<string>>();
const views = new WeakMap<ScreenCache, Map<string, View>>();
const hash = (key: QueryKey) => JSON.stringify(key);
export const bindHttpView = (cache: ScreenCache, key: QueryKey, view: View) => {
  view.waiting = true;
  const entries = views.get(cache) ?? new Map<string, View>();
  entries.set(hash(key), view);
  while (entries.size > 80) entries.delete(entries.keys().next().value!);
  views.set(cache, entries);
  return () => { view.waiting = false; };
};
export const isCurrentHttpView = (cache: ScreenCache, query: Query): boolean =>
  cache.isActive && (views.get(cache)?.get(hash(query.queryKey))?.current() ?? false);
export const publishHttpView = (cache: ScreenCache, query: Query) => {
  dirty.get(cache)?.delete(hash(query.queryKey));
  const entries = views.get(cache); const key = hash(query.queryKey); const view = entries?.get(key);
  if (!view || !cache.isActive || cache.readsPaused || view.waiting) return;
  if (!view.current()) { entries?.delete(key); return; }
  try { view.apply(JSON.parse(JSON.stringify(query.state.data))); } catch { entries?.delete(key); }
};
export const revokeHttpView = (cache: ScreenCache, key: QueryKey, previous: unknown) => {
  const entries = views.get(cache); const view = entries?.get(hash(key));
  if (view?.current()) {
    if (view.unavailable) view.unavailable();
    else if (Array.isArray(previous)) view.apply([]);
  }
  entries?.delete(hash(key));
};
export const markHttpDirty = (cache: ScreenCache, query: Query) => {
  const keys = dirty.get(cache) ?? new Set<string>(); keys.add(hash(query.queryKey)); dirty.set(cache, keys);
};
export const isHttpDirty = (cache: ScreenCache, key: QueryKey) => dirty.get(cache)?.has(hash(key)) ?? false;
export const forgetHttpQuery = (cache: ScreenCache, key: QueryKey) => {
  views.get(cache)?.delete(hash(key)); dirty.get(cache)?.delete(hash(key));
};
export const clearHttpViews = (cache: ScreenCache) => { views.delete(cache); dirty.delete(cache); };
