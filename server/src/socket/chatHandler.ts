/**
 * Socket.IO chat event handler.
 * Manages message send/receive and read-receipt lifecycle for a single socket.
 */
import type { Server, Socket } from 'socket.io';
import { CLIENT_EVENTS, SERVER_EVENTS, APP_ID, initialsForName } from './messaging';
import {
  addTripMessage,
  listTripMessages,
  markMessagesRead,
  countUnreadMessages,
} from '../db';
import { logError } from '../logger';
import { userJoined, userLeft, heartbeat, presenceList } from './presenceManager';
import { getUserDisplayName } from './userHelper';

export const registerChatHandlers = (io: Server, socket: Socket): void => {
  const user = socket.data.user;

  // -------------------------------------------------------------------------
  // JOIN_TRIP
  // -------------------------------------------------------------------------
  socket.on(CLIENT_EVENTS.JOIN_TRIP, async (tripId: string) => {
    if (!tripId) return;

    // Leave previous trip room if any
    if (socket.data.tripId && socket.data.tripId !== tripId) {
      const oldTrip = socket.data.tripId;
      socket.leave(`trip:${oldTrip}`);
      userLeft(oldTrip, user.id, (list) => {
        io.to(`trip:${oldTrip}`).emit(SERVER_EVENTS.PRESENCE_UPDATE, list);
      });
    }

    socket.data.tripId = tripId;
    socket.join(`trip:${tripId}`);

    // Resolve display name (may be in DB)
    const displayName = await getUserDisplayName(user.id, user.email);

    // Update presence
    const presence = userJoined(tripId, user.id, displayName);
    io.to(`trip:${tripId}`).emit(SERVER_EVENTS.PRESENCE_UPDATE, presence);

    // Send message history to this socket only
    try {
      const history = await listTripMessages(tripId);
      socket.emit(SERVER_EVENTS.MESSAGE_HISTORY, history);
    } catch (err) {
      logError('[chat] listTripMessages error', err);
      socket.emit(SERVER_EVENTS.ERROR, 'Unable to load chat history right now.');
      socket.emit(SERVER_EVENTS.MESSAGE_HISTORY, []);
    }

    // Send current unread count
    try {
      const unread = await countUnreadMessages(tripId, user.id);
      socket.emit(SERVER_EVENTS.UNREAD_COUNT, { tripId, count: unread });
    } catch {
      // non-fatal
    }
  });

  // -------------------------------------------------------------------------
  // LEAVE_TRIP
  // -------------------------------------------------------------------------
  socket.on(CLIENT_EVENTS.LEAVE_TRIP, (tripId: string) => {
    if (!tripId) return;
    socket.leave(`trip:${tripId}`);
    if (socket.data.tripId === tripId) socket.data.tripId = undefined;
    userLeft(tripId, user.id, (list) => {
      io.to(`trip:${tripId}`).emit(SERVER_EVENTS.PRESENCE_UPDATE, list);
    });
  });

  // -------------------------------------------------------------------------
  // SEND_MESSAGE
  // -------------------------------------------------------------------------
  socket.on(
    CLIENT_EVENTS.SEND_MESSAGE,
    async (payload: { tripId: string; body: string }) => {
      const { tripId, body } = payload ?? {};
      if (!tripId || !body?.trim()) return;

      const displayName = await getUserDisplayName(user.id, user.email);
      const initials = initialsForName(displayName);

      try {
        const saved = await addTripMessage({
          appId: APP_ID,
          tripId,
          senderId: user.id,
          senderName: displayName,
          senderInitials: initials,
          body: body.trim(),
        });

        // Broadcast to all members of the trip room (including sender)
        io.to(`trip:${tripId}`).emit(SERVER_EVENTS.NEW_MESSAGE, saved);
      } catch (err) {
        logError('[chat] addTripMessage error', err);
        socket.emit(SERVER_EVENTS.ERROR, 'Failed to send message');
      }
    },
  );

  // -------------------------------------------------------------------------
  // MARK_READ
  // -------------------------------------------------------------------------
  socket.on(
    CLIENT_EVENTS.MARK_READ,
    async (payload: { tripId: string; messageId: string }) => {
      const { tripId, messageId } = payload ?? {};
      if (!tripId || !messageId) return;

      try {
        await markMessagesRead(tripId, user.id, messageId);
        // Broadcast updated read receipt to the room
        io.to(`trip:${tripId}`).emit(SERVER_EVENTS.READ_RECEIPT, {
          messageId,
          userId: user.id,
        });
        // Send updated unread count to the reader only
        const unread = await countUnreadMessages(tripId, user.id);
        socket.emit(SERVER_EVENTS.UNREAD_COUNT, { tripId, count: unread });
      } catch (err) {
        logError('[chat] markMessagesRead error', err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // HEARTBEAT
  // -------------------------------------------------------------------------
  socket.on(CLIENT_EVENTS.HEARTBEAT, () => {
    if (socket.data.tripId) {
      heartbeat(socket.data.tripId, user.id);
    }
  });

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------
  socket.on('disconnect', () => {
    const tripId = socket.data.tripId;
    if (!tripId) return;
    userLeft(tripId, user.id, (list) => {
      io.to(`trip:${tripId}`).emit(SERVER_EVENTS.PRESENCE_UPDATE, list);
    });
  });
};
