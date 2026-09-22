import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Network from 'expo-network';
import { getSocket } from '../utils/socket';

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

export type ConnectionState = {
  status: ConnectionStatus;
  /** True when the device is offline or Socket.IO is actively retrying. */
  isDegraded: boolean;
};

// React Native exposes a number of browser-like globals. Platform is the
// reliable distinction; otherwise iOS can accidentally skip expo-network.
const isBrowser = (): boolean => Platform.OS === 'web';

const readBrowserOnline = (): boolean => {
  if (!isBrowser()) return true;
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
};

/**
 * Tracks connectivity by combining two signals:
 *   - The browser's `navigator.onLine` plus `online`/`offline` events
 *   - Socket.IO manager reconnection events
 *
 * Resolves to:
 *   - `'offline'`  — browser says we have no network
 *   - `'reconnecting'` — the device is online and Socket.IO is actively retrying
 *   - `'online'`   — the device is online; an idle or stopped real-time socket
 *                    does not make normal API-backed screens unavailable
 *
 * This is a stateless UI hook — it does not attempt reconnects itself; the
 * underlying Socket.IO client handles reconnect logic.
 */
export const useConnectionState = (): ConnectionState => {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() => readBrowserOnline());
  const [socketReconnecting, setSocketReconnecting] = useState<boolean>(false);

  useEffect(() => {
    if (isBrowser()) {
      const onOnline = () => setBrowserOnline(true);
      const onOffline = () => setBrowserOnline(false);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    }

    let disposed = false;
    const updateNetworkState = (state: Network.NetworkState) => {
      const online = state.isInternetReachable ?? state.isConnected ?? false;
      if (!disposed) setBrowserOnline(online);
    };
    void Network.getNetworkStateAsync().then(updateNetworkState).catch(() => {
      // If the platform cannot report its state, retain the optimistic default
      // and let normal request failures handle the next refresh.
    });
    const subscription = Network.addNetworkStateListener(updateNetworkState);
    return () => {
      disposed = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let socket;
    try {
      socket = getSocket();
    } catch {
      return;
    }

    const handleConnect = () => setSocketReconnecting(false);
    const handleReconnectAttempt = () => {
      setSocketReconnecting(true);
    };
    const handleReconnectComplete = () => {
      setSocketReconnecting(false);
    };
    const handleReconnectFailed = () => {
      setSocketReconnecting(false);
    };

    const manager = socket.io;
    socket.on('connect', handleConnect);
    // Since Socket.IO v3, reconnection lifecycle events are emitted by the
    // Manager (`socket.io`), not the namespace socket. Listening on the
    // socket meant this state could never accurately reflect retries.
    manager?.on('reconnect_attempt', handleReconnectAttempt);
    manager?.on('reconnect', handleReconnectComplete);
    manager?.on('reconnect_failed', handleReconnectFailed);

    return () => {
      socket.off('connect', handleConnect);
      manager?.off('reconnect_attempt', handleReconnectAttempt);
      manager?.off('reconnect', handleReconnectComplete);
      manager?.off('reconnect_failed', handleReconnectFailed);
    };
  }, []);

  let status: ConnectionStatus;
  if (!browserOnline) {
    status = 'offline';
  } else if (socketReconnecting) {
    status = 'reconnecting';
  } else {
    status = 'online';
  }

  return { status, isDegraded: status !== 'online' };
};
