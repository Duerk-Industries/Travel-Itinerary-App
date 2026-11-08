import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { addNetworkStateListener } from 'expo-network';
import { AppState } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { ScreenCache } from './screenCache';

type Scope = { cache: ScreenCache; ready: boolean };
const ScreenCacheContext = createContext<Scope | null>(null);
export const useScreenCache = () => useContext(ScreenCacheContext);

const AuthenticatedCache: React.FC<React.PropsWithChildren<{ cache: ScreenCache }>> = ({ cache, children }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    cache.start();
    void cache.restore().then(() => {
      if (active) {
        // Queries mounted while disk hydration was disabled must still revalidate.
        void cache.client.invalidateQueries({ refetchType: 'none' });
        setReady(true);
      }
    });
    const refresh = () => { void cache.client.refetchQueries({ type: 'active', stale: true }); };
    let wasConnected: boolean | undefined;
    const network = addNetworkStateListener(state => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      if (connected && wasConnected === false) refresh();
      wasConnected = connected;
    });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', refresh);
      window.addEventListener('online', refresh);
    }
    return () => {
      active = false; subscription.remove(); network.remove();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      }
      cache.stop();
    };
  }, [cache]);
  return <QueryClientProvider client={cache.client}><ScreenCacheContext.Provider value={{ cache, ready }}>{children}</ScreenCacheContext.Provider></QueryClientProvider>;
};

export const ScreenCacheProvider: React.FC<React.PropsWithChildren<{ userId: string | null; environment: string; token: string | null }>> = ({ userId, environment, token, children }) => {
  const cache = useMemo(() => userId && token ? new ScreenCache({ userId, environment }) : null, [userId, environment, token]);
  return cache ? <AuthenticatedCache key={cache.sessionId} cache={cache}>{children}</AuthenticatedCache> : <ScreenCacheContext.Provider value={null}>{children}</ScreenCacheContext.Provider>;
};
