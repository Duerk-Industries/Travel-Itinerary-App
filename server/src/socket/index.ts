/**
 * Socket.IO server setup.
 * Attach this to the HTTP server returned by `app.listen()`.
 */
import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { getBackendUrl, isLocalEnv } from '../env';
import { logInfo } from '../logger';
import { socketAuthMiddleware } from './authMiddleware';
import { registerChatHandlers } from './chatHandler';

let io: Server | null = null;

export const createSocketServer = (httpServer: HttpServer): Server => {
  // Default matches app.ts's HTTP CORS default ('https://duerk.org'), not a
  // localhost fallback — a wrong default would silently reject every WebSocket
  // handshake in production while HTTP API calls continued to work.
  const webUrl = getBackendUrl('https://duerk.org') ?? 'https://duerk.org';
  const corsOrigins = isLocalEnv()
    ? [
        'http://localhost:3000',
        'http://localhost:4000',
        'http://localhost:8081',
        'http://localhost:19006',
        webUrl,
      ]
    : [webUrl];

  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // React Native requires websocket-only (no polling fallback)
    transports: ['websocket', 'polling'],
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    logInfo(`[socket] connected: ${socket.id} user=${socket.data.user?.id}`);
    registerChatHandlers(io!, socket);
  });

  logInfo('[socket] Socket.IO server initialized');
  return io;
};

/** Returns the active Socket.IO server instance (or null if not yet created). */
export const getIo = (): Server | null => io;
