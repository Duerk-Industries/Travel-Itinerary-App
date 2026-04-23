import { useCallback, useEffect, useState } from 'react';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../../packages/messaging/src/events';
import type { PresenceUser } from '../../packages/messaging/src/types';
import { getSocket } from '../utils/socket';

type UseChatStateParams = {
  activeTripId: string | null;
  userToken: string | null;
};

/**
 * Owns the chat / presence UI state cluster (chat panel open, minimized,
 * unread count, presence list) plus the Socket.IO subscriptions that keep
 * them in sync: when `activeTripId` changes the hook joins that trip's
 * room and wires up listeners for presence and unread updates.
 *
 * Unread updates are ignored when they target a trip other than the
 * currently active one, matching the prior inline behavior.
 */
export const useChatState = ({ activeTripId, userToken }: UseChatStateParams) => {
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    if (!userToken || !activeTripId) return;
    const socket = getSocket();

    const onPresence = (list: PresenceUser[]) => setPresenceUsers(list);
    const onUnread = (data: { tripId: string; count: number }) => {
      if (data.tripId === activeTripId) setChatUnread(data.count);
    };

    socket.on(SERVER_EVENTS.PRESENCE_UPDATE, onPresence);
    socket.on(SERVER_EVENTS.UNREAD_COUNT, onUnread);

    if (socket.connected) {
      socket.emit(CLIENT_EVENTS.JOIN_TRIP, activeTripId);
    } else {
      socket.once('connect', () => {
        socket.emit(CLIENT_EVENTS.JOIN_TRIP, activeTripId);
      });
    }

    return () => {
      socket.off(SERVER_EVENTS.PRESENCE_UPDATE, onPresence);
      socket.off(SERVER_EVENTS.UNREAD_COUNT, onUnread);
    };
  }, [activeTripId, userToken]);

  const openChat = useCallback(() => {
    setChatOpen(true);
    setChatMinimized(false);
  }, []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const minimizeChat = useCallback(() => setChatMinimized(true), []);
  const restoreChat = useCallback(() => setChatMinimized(false), []);

  const clearChatState = useCallback(() => {
    setPresenceUsers([]);
    setChatOpen(false);
    setChatMinimized(false);
    setChatUnread(0);
  }, []);

  return {
    presenceUsers,
    chatOpen,
    chatMinimized,
    chatUnread,
    setPresenceUsers,
    setChatOpen,
    setChatMinimized,
    setChatUnread,
    openChat,
    closeChat,
    minimizeChat,
    restoreChat,
    clearChatState,
  };
};
