/**
 * Socket.IO client singleton for WanderBunnies.
 *
 * Usage:
 *   const socket = getSocket();
 *   socket.connect();
 *   socket.emit(CLIENT_EVENTS.JOIN_TRIP, tripId);
 */
import { io, type Socket } from 'socket.io-client';
import { Platform } from 'react-native';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../../packages/messaging/src/events';
import type { ChatMessage, PresenceUser } from '../../packages/messaging/src/types';
import { resolveBackendUrl } from './backendUrl';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const resolveSocketServerUrl = (): string =>
  resolveBackendUrl({
    envConfigured:
      (typeof process !== 'undefined' &&
        (process.env.EXPO_PUBLIC_BACKEND_URL ??
          process.env.BACKEND_URL ??
          process.env.WEB_URL ??
          process.env.API_BASE_URL ??
          process.env.API_BASE ??
          process.env.REACT_APP_BACKEND_URL ??
          process.env.REACT_NATIVE_APP_BACKEND_URL)) ||
      '',
    nodeEnv: typeof process !== 'undefined' ? process.env.NODE_ENV : undefined,
    platformOs: Platform.OS,
    browserLocation: Platform.OS === 'web' && typeof window !== 'undefined' ? window.location : undefined,
  });

export const resolveSocketTransports = (): Array<'polling' | 'websocket'> =>
  // Polling MUST be listed first. Confirmed via production Cloud Run logs:
  // every `GET /socket.io/?transport=websocket` handshake gets HTTP 400
  // (the Firebase Hosting → Cloud Run rewrite doesn't preserve the upgrade),
  // and — per socket.io's own documented behavior — `['websocket', 'polling']`
  // does NOT reliably fall back to polling when the initial websocket attempt
  // fails; the client just retries websocket forever via its reconnection
  // loop (see socketio/socket.io#2751, #5122, #3998). Polling-first avoids
  // that failure mode entirely: the connection establishes over HTTP
  // long-polling (which Firebase Hosting proxies fine), and Engine.IO then
  // opportunistically tries to upgrade to websocket — an upgrade failure is
  // handled gracefully and does not drop the connection, unlike an initial
  // connection failure.
  ['polling', 'websocket'];

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!_socket) {
    _socket = io(resolveSocketServerUrl(), {
      // Firebase Hosting rewrites reliably proxy HTTP long polling to Cloud Run,
      // while websocket upgrades can be blocked before they reach Socket.IO.
      transports: resolveSocketTransports(),
      // Belt-and-suspenders: if the first-listed transport still fails outright
      // (e.g. polling itself gets blocked in some environment), this makes the
      // client actually try the remaining ones instead of retrying the same
      // failing transport forever. Available since socket.io-client 4.8.0.
      tryAllTransports: true,
      autoConnect: false,
    });
  }
  return _socket;
};

const logSocketFailure = (action: string, err: unknown): void => {
  // Real-time features are non-critical to app startup. Log and continue so a
  // transport hiccup never takes down the whole app.
  // eslint-disable-next-line no-console
  console.warn(`[socket] ${action} failed`, err);
};

/** Connect the socket with the current JWT. Call after login. */
export const connectSocket = (token: string): void => {
  try {
    const socket = getSocket();
    socket.auth = { token };
    if (!socket.connected) socket.connect();
  } catch (err) {
    logSocketFailure('connect', err);
  }
};

/** Disconnect and destroy the socket instance. Call on logout. */
export const disconnectSocket = (): void => {
  try {
    if (_socket) {
      _socket.disconnect();
      _socket = null;
    }
  } catch (err) {
    logSocketFailure('disconnect', err);
  }
};

// ---------------------------------------------------------------------------
// Typed event helpers
// ---------------------------------------------------------------------------

export { CLIENT_EVENTS, SERVER_EVENTS };
export type { ChatMessage, PresenceUser };
