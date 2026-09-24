import type { Server, Socket } from 'socket.io';
import { ensureUserCanReadTrip } from '../db';
import { logError } from '../logger';

export const registerBlogHandlers = (io: Server, socket: Socket): void => {
  const user = socket.data.user;

  socket.on('JOIN_BLOG', async (tripId: string) => {
    if (!tripId) return;

    try {
      const membership = await ensureUserCanReadTrip(tripId, user.id);
      if (!membership) {
        socket.emit('ERROR', 'Not authorized to view this trip blog.');
        return;
      }

      // Travelers join both, followers join only followers room.
      socket.join(`trip:${tripId}:followers`);
      if (membership.access === 'member') {
        socket.join(`trip:${tripId}:travelers`);
      }

      socket.data.blogTripId = tripId;
    } catch (err) {
      logError('[blog-socket] JOIN_BLOG failed', err);
    }
  });

  socket.on('LEAVE_BLOG', (tripId: string) => {
    socket.leave(`trip:${tripId}:followers`);
    socket.leave(`trip:${tripId}:travelers`);
    socket.data.blogTripId = undefined;
  });
};
