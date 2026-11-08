import { isCurrentHttpView } from './httpViews';
import { registerScreenSession } from './screenSession';
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { addNetworkStateListener } from 'expo-network';
import { AppState } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { ScreenCache } from './screenCache';

type Scope = { cache: ScreenCache; ready: boolean; stale: boolean; refresh: () => void };
const ScreenCacheContext = createContext<Scope | null>(null);
export const useScreenCache = () => useContext(ScreenCacheContext);

const AuthenticatedCache: React.FC<React.PropsWithChildren<{ cache: ScreenCache; token: string }>> = ({ cache, token, children }) => {
  const [ready, setReady] = useState(false);
  const [stale, setStale] = useState(false);
  const refresh = () => {
    if (cache.readsPaused) return;
    void cache.client.refetchQueries({ predicate: query => {
      if (query.isActive()) return query.isStale();
      const staleTime = typeof query.meta?.httpStaleTime === 'number' ? query.meta.httpStaleTime : 0;
      return isCurrentHttpView(cache, query) && (query.state.status === 'error' || query.isStaleByTime(staleTime));
    } });
  };
  // Register before descendant passive effects start their screen reads.
  useLayoutEffect(() => {
    cache.start();
    const unregister = registerScreenSession(cache, token);
    return () => { unregister(); cache.stop(); };
  }, [cache, token]);
  useEffect(() => {
    let active = true;
    void cache.restore().then(() => {
      if (active) {
        // Queries mounted while disk hydration was disabled must still revalidate.
        void cache.client.invalidateQueries({ refetchType: 'none' });
        setReady(true);
      }
    });
    const unsubscribe = cache.client.getQueryCache().subscribe(() => {
      setStale(cache.client.getQueryCache().getAll().some(query => isCurrentHttpView(cache, query) && query.state.status === 'error' && query.state.data != null));
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'background' || (typeof document !== 'undefined' && document.hidden)) return;
      refresh();
    }, 60_000);
    let wasConnected: boolean | undefined;
    const network = addNetworkStateListener(state => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      if (connected && wasConnected === false) refresh();
      wasConnected = connected;
    });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', refresh);
      window.addEventListener('online', refresh);
    }
    return () => {
      active = false; subscription.remove(); network.remove(); unsubscribe(); clearInterval(timer);
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      }
    };
  }, [cache, token]);
  return <QueryClientProvider client={cache.client}><ScreenCacheContext.Provider value={{ cache, ready, stale, refresh }}>{children}</ScreenCacheContext.Provider></QueryClientProvider>;
};

export const ScreenCacheProvider: React.FC<React.PropsWithChildren<{ userId: string | null; environment: string; token: string | null }>> = ({ userId, environment, token, children }) => {
  const cache = useMemo(() => userId && token ? new ScreenCache({ userId, environment }) : null, [userId, environment, token]);
  return cache ? <AuthenticatedCache key={cache.sessionId} cache={cache} token={token!}>{children}</AuthenticatedCache> : <ScreenCacheContext.Provider value={null}>{children}</ScreenCacheContext.Provider>;
};
