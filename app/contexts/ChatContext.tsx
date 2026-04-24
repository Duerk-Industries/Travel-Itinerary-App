import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SERVER_EVENTS } from '../../packages/messaging/src/events';
import { getSocket } from '../utils/socket';

type ChatContextValue = {
  chatOpen: boolean;
  chatMinimized: boolean;
  chatUnread: number;
  setChatUnread: (count: number) => void;
  openChat: () => void;
  closeChat: () => void;
  minimizeChat: () => void;
  restoreChat: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

type ChatProviderProps = {
  activeTripId: string | null;
  userToken: string | null;
  children: React.ReactNode;
};

/**
 * Owns chat-panel UI state (open / minimized / unread count) and the
 * UNREAD_COUNT socket subscription. Kept separate from presence so that
 * per-heartbeat presence updates don't re-render chat consumers and
 * vice-versa.
 */
export const ChatProvider: React.FC<ChatProviderProps> = ({ activeTripId, userToken, children }) => {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    if (!userToken || !activeTripId) {
      setChatOpen(false);
      setChatMinimized(false);
      setChatUnread(0);
      return;
    }
    const socket = getSocket();
    const onUnread = (data: { tripId: string; count: number }) => {
      if (data.tripId === activeTripId) setChatUnread(data.count);
    };
    socket.on(SERVER_EVENTS.UNREAD_COUNT, onUnread);
    return () => {
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

  const value = useMemo<ChatContextValue>(
    () => ({
      chatOpen,
      chatMinimized,
      chatUnread,
      setChatUnread,
      openChat,
      closeChat,
      minimizeChat,
      restoreChat,
    }),
    [chatOpen, chatMinimized, chatUnread, openChat, closeChat, minimizeChat, restoreChat]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = (): ChatContextValue => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
};
