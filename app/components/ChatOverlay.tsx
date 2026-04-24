import React from 'react';
import ChatButton from './ChatButton';
import ChatPanel from './ChatPanel';
import { useChat } from '../contexts/ChatContext';
import { getSocket } from '../utils/socket';
import type { AppTheme } from '../theme/theme';

type Props = {
  userToken: string | null;
  activeTripId: string | null;
  userId: string | null;
  userName: string | null;
  theme?: AppTheme;
};

/**
 * Renders the chat FAB / panel / minimized badge based on the chat
 * context. Keeping this as a leaf consumer means open/close/unread
 * transitions only re-render this subtree rather than the entire shell.
 */
const ChatOverlay: React.FC<Props> = ({ userToken, activeTripId, userId, userName, theme }) => {
  const { chatOpen, chatMinimized, chatUnread, openChat, closeChat, minimizeChat, restoreChat, setChatUnread } =
    useChat();

  if (!userToken || !activeTripId) return null;

  if (!chatOpen) {
    return <ChatButton onPress={openChat} unreadCount={chatUnread} />;
  }

  if (chatMinimized) {
    return <ChatButton onPress={restoreChat} unreadCount={chatUnread} />;
  }

  return (
    <ChatPanel
      socket={getSocket()}
      tripId={activeTripId}
      currentUserId={userId ?? ''}
      currentUserName={userName ?? 'Traveler'}
      onClose={closeChat}
      onMinimize={minimizeChat}
      unreadCount={chatUnread}
      onUnreadChange={setChatUnread}
      theme={theme}
    />
  );
};

export default ChatOverlay;
