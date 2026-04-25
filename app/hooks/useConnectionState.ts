import { useEffect, useState } from 'react';
import { getSocket } from '../utils/socket';

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

export type ConnectionState = {
  status: ConnectionStatus;
  /** True when either the browser reports offline or the socket is down. */
  isDegraded: boolean;
};

const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof window.addEventListener === 'function';

const readBrowserOnline = (): boolean => {
  if (!isBrowser()) return true;
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
};

/**
 * Tracks connectivity by combining two signals:
 *   - The browser's `navigator.onLine` plus `online`/`offline` events
 *   - The Socket.IO client's `connect`/`disconnect`/`reconnect_attempt` events
 *
 * Resolves to:
 *   - `'offline'`  — browser says we have no network
 *   - `'reconnecting'` — browser is online but socket is actively reconnecting
 *   - `'online'`   — browser is online and socket is connected (or idle, which
 *                    is treated as online to avoid false banners pre-login)
 *
 * This is a stateless UI hook — it does not attempt reconnects itself; the
 * underlying Socket.IO client handles reconnect logic.
 */
export const useConnectionState = (): ConnectionState => {
  const [browserOnline, setBrowserOnline] = useState<boolean>(() => readBrowserOnline());
  const [socketConnected, setSocketConnected] = useState<boolean>(() => {
    try {
      return getSocket().connected;
    } catch {
      return false;
    }
  });
  const [socketReconnecting, setSocketReconnecting] = useState<boolean>(false);
  const [socketInitiated, setSocketInitiated] = useState<boolean>(() => {
    try {
      return getSocket().connected;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!isBrowser()) return;
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    let socket;
    try {
      socket = getSocket();
    } catch {
      return;
    }

    const handleConnect = () => {
      setSocketConnected(true);
      setSocketReconnecting(false);
      setSocketInitiated(true);
    };
    const handleDisconnect = () => {
      setSocketConnected(false);
    };
    const handleReconnectAttempt = () => {
      setSocketReconnecting(true);
    };
    const handleReconnectFailed = () => {
      setSocketReconnecting(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('reconnect_failed', handleReconnectFailed);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('reconnect_failed', handleReconnectFailed);
    };
  }, []);

  let status: ConnectionStatus;
  if (!browserOnline) {
    status = 'offline';
  } else if (socketInitiated && (!socketConnected || socketReconnecting)) {
    status = 'reconnecting';
  } else {
    status = 'online';
  }

  return { status, isDegraded: status !== 'online' };
};
