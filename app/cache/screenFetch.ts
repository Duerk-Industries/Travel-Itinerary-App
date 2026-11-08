import { bindHttpView, isHttpDirty, markHttpDirty, revokeHttpView } from './httpViews';
import { isCancelledError, type Query } from '@tanstack/react-query';
import { findScreenSession } from './screenSession';
import { httpCachePolicy, mutationCategories, validHttpPayload, type HttpCacheCategory } from './httpCachePolicy';

export type ScreenFetchOptions = RequestInit & {
  /** Display saved server data while the fresh request runs. Never pass a draft setter. */
  onCached?: (value: unknown) => void;
  /** Reject a callback after navigation, filtering or unmount. */
  isCurrent?: () => boolean;
  onUnavailable?: () => void;
};
class HttpResult extends Error { constructor(readonly response: Response) { super(`HTTP ${response.status}`); } }
const asResponse = (data: unknown, stale = false): Response => new Response(JSON.stringify(data), {
  status: 200, headers: { 'Content-Type': 'application/json', ...(stale ? { 'X-WanderBunnies-Cache': 'stale' } : {}) },
});
const cancelled = () => Object.assign(new Error('The request is no longer current.'), { name: 'AbortError' });
const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const authorization = (headers?: HeadersInit): string | undefined => {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get('Authorization') ?? undefined;
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  return Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')?.[1];
};
const forCaller = <T,>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelled()); };
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
};

/** Explicit fetch import for screens/helpers; does not patch the platform fetch implementation. */
export const screenFetch = async (input: RequestInfo | URL, options: ScreenFetchOptions = {}): Promise<Response> => {
  const { onCached, isCurrent, onUnavailable, ...init } = options;
  if (options.isCurrent?.() === false || options.signal?.aborted) throw cancelled();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const token = authorization(init.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined))?.replace(/^Bearer\s+/i, '');
  const cache = token ? findScreenSession(url, token) : undefined;
  if (!cache) return globalThis.fetch(input, init);
  const path = url.slice(cache.owner.environment.replace(/\/$/, '').length);
  const pathname = path.split('?')[0];
  const method = (init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  const current = () => cache.isActive && !init.signal?.aborted && (isCurrent?.() ?? true);
  if (method !== 'GET') {
    const categories = mutationCategories(pathname);
    const affected = (query: Query) => categories.includes(query.meta?.httpCategory as HttpCacheCategory);
    if (categories.length) void cache.client.cancelQueries({ predicate: affected });
    const response = await globalThis.fetch(input, init);
    if (response.ok && current() && categories.length) {
      for (const query of cache.client.getQueryCache().getAll().filter(affected)) markHttpDirty(cache, query);
      cache.persist();
      // Revalidate on next read; do not refresh an open form behind its draft.
      await cache.client.invalidateQueries({ predicate: affected, refetchType: 'none' });
      if (/packing|members|groups|trip-templates/.test(pathname)) {
        void cache.client.invalidateQueries({ queryKey: ['packing'] });
      }
    }
    return response;
  }
  const policy = httpCachePolicy(pathname);
  if (!policy || init.cache === 'no-store') return globalThis.fetch(input, init);
  await cache.restore();
  if (!current()) throw cancelled();
  const key = ['http', path];
  let saved = policy.cachedView && !isHttpDirty(cache, key) ? cache.client.getQueryData(key) : undefined;
  let finishRead = () => {};
  if (onCached && policy.cachedView) {
    finishRead = bindHttpView(cache, key, { apply: onCached, current, unavailable: onUnavailable });
    if (saved != null && current()) {
      try { onCached(copy(saved)); }
      catch { saved = undefined; cache.client.removeQueries({ queryKey: key, exact: true }); cache.discardPersisted(); }
    }
  }
  try {
    const data = await forCaller(cache.client.fetchQuery({
      queryKey: key, staleTime: policy.staleTime,
      meta: { persist: policy.persist, httpCategory: policy.category, httpStaleTime: policy.staleTime },
      queryFn: async ({ signal }) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        try {
          const response = await globalThis.fetch(input, { ...init, signal: controller.signal });
          if ([401, 402, 403, 404].includes(response.status)) {
            revokeHttpView(cache, key, cache.client.getQueryData(key));
            cache.client.setQueryData(key, null);
            cache.discardPersisted();
          }
          if (!response.ok || response.status !== 200) throw new HttpResult(response);
          const contentType = response.headers?.get?.('Content-Type') ?? '';
          if (/^(image|audio|video)\/|application\/(octet-stream|pdf)/i.test(contentType)) throw new HttpResult(response);
          let value: unknown;
          try { value = await response.clone().json(); } catch { throw new HttpResult(response); }
          if (!validHttpPayload(pathname, value)) throw new Error('The server returned an invalid response.');
          return value;
        } finally {
          signal.removeEventListener('abort', abort);
        }
      },
    }), init.signal);
    if (!current()) throw cancelled();
    return asResponse(data);
  } catch (error) {
    if (!current() || isCancelledError(error) || (error instanceof Error && error.name === 'AbortError')) throw cancelled();
    if (error instanceof HttpResult && [401, 402, 403, 404].includes(error.response.status)) {
      cache.client.removeQueries({ queryKey: key, exact: true });
      cache.discardPersisted();
      return typeof error.response.clone === 'function' ? error.response.clone() : error.response;
    }
    if (saved != null && policy.cachedView && (!(error instanceof HttpResult) || error.response.status >= 500)) return asResponse(copy(saved), true);
    if (error instanceof HttpResult) return typeof error.response.clone === 'function' ? error.response.clone() : error.response;
    throw error;
  } finally { finishRead(); }
};
