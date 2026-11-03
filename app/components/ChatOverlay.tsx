import { resolveComponentTheme as resolveStyleTheme, type AppTheme } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React from 'react';
import ChatButton from './ChatButton';
import ChatPanel from './ChatPanel';
import { useChat } from '../contexts/ChatContext';
import { getSocket } from '../utils/socket';


type Props = {
  userToken: string | null;
  activeTripId: string | null;
  userId: string | null;
  userName: string | null;
  theme?: AppTheme;
  notificationRequest?: { tripId: string; key: number } | null;
};

/**
 * Renders the chat FAB / panel / minimized badge based on the chat
 * context. Keeping this as a leaf consumer means open/close/unread
 * transitions only re-render this subtree rather than the entire shell.
 */
const ChatOverlay: React.FC<Props> = ({ userToken, activeTripId, userId, userName, notificationRequest, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const { chatOpen, chatMinimized, chatUnread, openChat, closeChat, minimizeChat, restoreChat, setChatUnread } =
    useChat();
  React.useEffect(() => {
    if (userToken && notificationRequest?.tripId === activeTripId) openChat();
  }, [userToken, activeTripId, notificationRequest, openChat]);

  if (!userToken || !activeTripId) return null;

  if (!chatOpen) {
    return <ChatButton onPress={openChat} unreadCount={chatUnread} />;
  }

  if (chatMinimized) {
    return <ChatButton onPress={restoreChat} unreadCount={chatUnread} />;
  }

  return (
    <ChatPanel
      key={activeTripId}
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
