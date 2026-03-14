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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const getServerUrl = (): string => {
  if (Platform.OS === 'web') {
    // Same origin in production; localhost in dev
    return typeof window !== 'undefined' && window.location?.hostname !== 'localhost'
      ? window.location.origin
      : 'http://localhost:4000';
  }
  // Native: use explicit API base
  return process.env.API_BASE ?? 'http://localhost:4000';
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!_socket) {
    _socket = io(getServerUrl(), {
      // React Native requires websocket transport
      transports: Platform.OS === 'web' ? ['polling', 'websocket'] : ['websocket'],
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
