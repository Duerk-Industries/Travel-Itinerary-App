/**
 * ChatPanel — the sliding chat overlay for a trip.
 *
 * Desktop/web: Partial-screen panel anchored to the bottom-right with a
 *              minimize button.
 * Mobile: Full-screen modal with a back button.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import type { Socket } from 'socket.io-client';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../../packages/messaging/src/events';
import type { ChatMessage } from '../../packages/messaging/src/types';
import type { AppTheme } from '../theme/theme';

interface Props {
  socket: Socket;
  tripId: string;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onMinimize?: () => void;
  unreadCount: number;
  onUnreadChange: (count: number) => void;
  theme?: AppTheme;
}

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;

const ChatPanel: React.FC<Props> = ({
  socket,
  tripId,
  currentUserId,
  currentUserName,
  onClose,
  onMinimize,
  unreadCount,
  onUnreadChange,
  theme,
}) => {
  const themedStyles = React.useMemo(() => buildStyles(theme), [theme]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const flatListRef = useRef<any>(null);
  const isWeb = Platform.OS === 'web';

  // -------------------------------------------------------------------------
  // Join trip room and wire up events
  // -------------------------------------------------------------------------
  useEffect(() => {
    setLoading(true);
    setErrorMessage(null);

    const joinAndListen = () => {
      socket.emit(CLIENT_EVENTS.JOIN_TRIP, tripId);
    };

    const onHistory = (history: ChatMessage[]) => {
      setMessages(history);
      setErrorMessage(null);
      setLoading(false);
      // Scroll to bottom
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    };

    const onNewMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      // Auto-mark as read when panel is open
      socket.emit(CLIENT_EVENTS.MARK_READ, { tripId, messageId: msg.id });
    };

    const onUnreadCount = (data: { tripId: string; count: number }) => {
      if (data.tripId === tripId) onUnreadChange(data.count);
    };

    const onChatError = (message: string) => {
      setMessages([]);
      setErrorMessage(message || 'Unable to load chat right now.');
      setLoading(false);
    };

    const onConnectError = () => {
      setMessages([]);
      setErrorMessage('Unable to connect to chat right now.');
      setLoading(false);
    };

    const historyTimeout = setTimeout(() => {
      setMessages([]);
      setErrorMessage('Unable to load chat history right now.');
      setLoading(false);
    }, 5000);

    socket.on(SERVER_EVENTS.MESSAGE_HISTORY, onHistory);
    socket.on(SERVER_EVENTS.NEW_MESSAGE, onNewMessage);
    socket.on(SERVER_EVENTS.UNREAD_COUNT, onUnreadCount);
    socket.on(SERVER_EVENTS.ERROR, onChatError);

    // Join now if already connected, otherwise join when connection establishes
    if (socket.connected) {
      joinAndListen();
    }
    socket.on('connect', joinAndListen);
    socket.on('connect_error', onConnectError);

    return () => {
      clearTimeout(historyTimeout);
      socket.off(SERVER_EVENTS.MESSAGE_HISTORY, onHistory);
      socket.off(SERVER_EVENTS.NEW_MESSAGE, onNewMessage);
      socket.off(SERVER_EVENTS.UNREAD_COUNT, onUnreadCount);
      socket.off(SERVER_EVENTS.ERROR, onChatError);
      socket.off('connect', joinAndListen);
      socket.off('connect_error', onConnectError);
    };
  }, [socket, tripId, onUnreadChange]);

  // -------------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------------
  const sendMessage = useCallback(() => {
    const body = inputText.trim();
    if (!body) return;
    socket.emit(CLIENT_EVENTS.SEND_MESSAGE, { tripId, body });
    setInputText('');
  }, [inputText, socket, tripId]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isOwn = item.senderId === currentUserId;
    return (
      <View
        style={[themedStyles.messageRow, isOwn ? themedStyles.ownRow : themedStyles.otherRow]}
        testID={`chat-message-${item.id}`}
      >
        {!isOwn && (
          <View style={[themedStyles.avatarSmall, { backgroundColor: theme?.colors.textMuted ?? '#9e9e9e' }]}>
            <Text style={themedStyles.avatarText}>{item.senderInitials}</Text>
          </View>
        )}
        <View style={[themedStyles.bubble, isOwn ? themedStyles.ownBubble : themedStyles.otherBubble]}>
          {!isOwn && (
            <Text style={themedStyles.senderName}>{item.senderName}</Text>
          )}
          <Text style={isOwn ? themedStyles.ownText : themedStyles.otherText}>{item.body}</Text>
          <Text style={themedStyles.timestamp}>
            {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------
  const panelStyle = isWeb
    ? themedStyles.panelDesktop
    : themedStyles.panelMobile;

  return (
    <KeyboardAvoidingView
      style={[themedStyles.container, panelStyle]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="chat-panel"
    >
      {/* Header */}
      <View style={themedStyles.header}>
        {!isWeb && (
          <TouchableOpacity onPress={onClose} style={themedStyles.headerBtn} testID="chat-back">
            <Text style={themedStyles.headerBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={themedStyles.headerTitle}>Trip Chat</Text>
        {isWeb && onMinimize && (
          <TouchableOpacity onPress={onMinimize} style={themedStyles.headerBtn} testID="chat-minimize">
            <Text style={themedStyles.headerBtnText}>—</Text>
          </TouchableOpacity>
        )}
        {isWeb && (
          <TouchableOpacity onPress={onClose} style={themedStyles.headerBtn} testID="chat-close">
            <Text style={themedStyles.headerBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Message list */}
      {loading ? (
        <View style={themedStyles.loadingContainer}>
          <ActivityIndicator />
        </View>
      ) : errorMessage ? (
        <View style={themedStyles.stateContainer} testID="chat-error-state">
          <Text style={themedStyles.stateTitle}>Chat unavailable</Text>
          <Text style={themedStyles.stateBody}>{errorMessage}</Text>
        </View>
      ) : !messages.length ? (
        <View style={themedStyles.stateContainer} testID="chat-empty-state">
          <Text style={themedStyles.stateTitle}>No messages yet</Text>
          <Text style={themedStyles.stateBody}>Start the conversation for this trip.</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={themedStyles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          testID="chat-message-list"
        />
      )}

      {/* Input */}
      <View style={themedStyles.inputRow}>
        <TextInput
          style={themedStyles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Message the group… (@ to mention)"
          placeholderTextColor="#999"
          multiline
          maxLength={2000}
          onSubmitEditing={isWeb ? sendMessage : undefined}
          blurOnSubmit={false}
          testID="chat-input"
        />
        <TouchableOpacity
          onPress={sendMessage}
          style={[themedStyles.sendBtn, !inputText.trim() && themedStyles.sendBtnDisabled]}
          disabled={!inputText.trim()}
          testID="chat-send"
        >
          <Text style={themedStyles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const buildStyles = (theme?: AppTheme) => StyleSheet.create({
  container: {
    backgroundColor: theme?.colors.surface ?? '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  panelDesktop: {
    position: 'absolute' as any,
    bottom: 80,
    right: 16,
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? '#e0e0e0',
  },
  panelMobile: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1565C0',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  stateTitle: {
    color: theme?.colors.text ?? '#1a1a1a',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    color: theme?.colors.textMuted ?? '#555',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  messageList: {
    padding: 10,
    paddingBottom: 4,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  ownRow: {
    justifyContent: 'flex-end',
  },
  otherRow: {
    justifyContent: 'flex-start',
  },
  avatarSmall: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    marginBottom: 4,
  },
  avatarText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  bubble: {
    maxWidth: '75%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ownBubble: {
    backgroundColor: '#1565C0',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: theme?.colors.surfaceMuted ?? '#f0f0f0',
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 11,
    fontWeight: '700',
    color: theme?.colors.textMuted ?? '#555',
    marginBottom: 2,
  },
  ownText: {
    color: '#fff',
    fontSize: 14,
  },
  otherText: {
    color: theme?.colors.text ?? '#1a1a1a',
    fontSize: 14,
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 3,
    textAlign: 'right',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: theme?.colors.border ?? '#e0e0e0',
    padding: 8,
    backgroundColor: theme?.colors.backgroundAlt ?? '#fafafa',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? '#ccc',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 14,
    backgroundColor: theme?.colors.surface ?? '#fff',
    color: theme?.colors.text ?? '#1a1a1a',
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#1565C0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnDisabled: {
    backgroundColor: theme?.mode === 'dark' ? theme.colors.surfaceMuted : '#bdbdbd',
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});

export default ChatPanel;
