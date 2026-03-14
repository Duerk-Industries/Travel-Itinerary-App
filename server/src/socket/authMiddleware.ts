/**
 * Socket.IO authentication middleware.
 * Verifies the JWT passed as `auth.token` in the handshake and attaches
 * the decoded user payload to `socket.data.user`.
 */
import type { Socket } from 'socket.io';
import { verifyToken } from '../auth';

export interface SocketUser {
  id: string;
  email: string;
  role: string;
}

declare module 'socket.io' {
  interface SocketData {
    user: SocketUser;
    /** Active trip rooms the socket has joined */
    tripId?: string;
  }
}

export const socketAuthMiddleware = (
  socket: Socket,
  next: (err?: Error) => void,
): void => {
  const token =
    (socket.handshake.auth as Record<string, string>)?.token ??
    (socket.handshake.headers['authorization'] as string | undefined)?.replace(/^Bearer /i, '');

  if (!token) {
    return next(new Error('Authentication token required'));
  }

  try {
    const payload = verifyToken(token);
    socket.data.user = {
      id: String(payload.userId ?? ''),
      email: String(payload.email ?? ''),
      role: String(payload.role ?? 'user'),
    };
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
};
