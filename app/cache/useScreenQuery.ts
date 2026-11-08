import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, useQuery, type QueryKey } from '@tanstack/react-query';
import { useScreenCache } from './ScreenCacheProvider';
import { cachePolicies } from './screenCache';

export class ScreenRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Options<T> = {
  queryKey: QueryKey;
  fetcher: (signal: AbortSignal) => Promise<T>;
  validate: (value: unknown) => value is T;
  enabled?: boolean;
  paused?: boolean;
  policy: keyof typeof cachePolicies;
};

/** Reusable cached-view contract: explicitly opt data into persistence; writes stay online. */
export function useScreenQuery<T>({ queryKey, fetcher, validate, enabled = true, paused = false, policy }: Options<T>) {
  const scope = useScreenCache();
  const fallback = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }), []);
  const client = scope?.cache.client ?? fallback;
  const [writes, setWrites] = useState(0);
  const mounted = useRef(true);
  const settings = cachePolicies[policy];
  const query = useQuery<T, Error>({
    queryKey, enabled: enabled && !paused && writes === 0 && (!scope || scope.ready),
    staleTime: settings.staleTime, refetchOnMount: 'always',
    refetchInterval: scope && policy === 'trip' ? 60_000 : false,
    meta: { persist: Boolean(scope && settings.persist) },
    queryFn: async ({ signal }) => {
      try {
        const value = await fetcher(signal);
        if (!validate(value)) throw new Error('The server returned an invalid response.');
        return value;
      } catch (error) {
        if (error instanceof ScreenRequestError && [401, 403, 404].includes(error.status)) {
          // Do not show a saved private response after access has been rejected.
          client.setQueryData(queryKey, null);
          scope?.cache.discardPersisted();
        }
        throw error;
      }
    },
  }, client);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (!scope) fallback.clear(); };
  }, [fallback, scope?.cache]);
  const forget = () => {
    if (scope && !scope.cache.isActive) return;
    client.setQueryData(queryKey, null);
    scope?.cache.discardPersisted();
  };
  const publish = (value: T | ((previous: T | undefined) => T)) => {
    if (scope ? scope.cache.isActive : mounted.current) {
      // A remounted observer may have started another read while this write was in flight.
      void client.cancelQueries({ queryKey, exact: true });
      client.setQueryData<T>(queryKey, value);
    }
  };
  const runWrite = async <R,>(operation: () => Promise<R>, invalidate: QueryKey[] = []): Promise<R> => {
    setWrites(count => count + 1);
    // Cancellation takes effect synchronously; keep optimistic UI updates synchronous too.
    void client.cancelQueries({ queryKey, exact: true });
    try { return await operation(); }
    finally {
      if (mounted.current) setWrites(count => count - 1);
      if (!scope || scope.cache.isActive) {
        for (const key of invalidate) void client.invalidateQueries({ queryKey: key });
      }
    }
  };
  return { ...query, isWriting: writes > 0, data: validate(query.data) ? query.data : undefined, publish, forget, runWrite,
    refresh: () => !paused && writes === 0 ? query.refetch() : Promise.resolve(),
  };
}
