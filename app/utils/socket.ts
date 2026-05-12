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

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!_socket) {
    _socket = io(resolveSocketServerUrl(), {
      // Prefer websocket-only transport so the web client does not fall back to
      // repeated long-polling requests while the app is otherwise idle.
      transports: ['websocket'],
      autoConnect: false,
    });
  }
  return _socket;
};

/** Connect the socket with the current JWT. Call after login. */
export const connectSocket = (token: string): void => {
  const socket = getSocket();
  socket.auth = { token };
  if (!socket.connected) socket.connect();
};

/** Disconnect and destroy the socket instance. Call on logout. */
export const disconnectSocket = (): void => {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
};

// ---------------------------------------------------------------------------
// Typed event helpers
// ---------------------------------------------------------------------------

export { CLIENT_EVENTS, SERVER_EVENTS };
export type { ChatMessage, PresenceUser };
