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
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // firstUnreadId marks the oldest unread message at the moment the panel
  // opened. It is set once (when the initial history page arrives) and never
  // moves afterwards — the "New messages" separator is an at-open snapshot,
  // not a live cursor.
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const initialUnreadCountRef = useRef(unreadCount);
  const flatListRef = useRef<any>(null);
  const lastMarkedReadIdRef = useRef<string | null>(null);
  const scrollTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const isWeb = Platform.OS === 'web';

  const scheduleScrollToEnd = useCallback(
    (delayMs: number, animated: boolean) => {
      const id = setTimeout(() => {
        scrollTimersRef.current.delete(id);
        flatListRef.current?.scrollToEnd({ animated });
      }, delayMs);
      scrollTimersRef.current.add(id);
    },
    [],
  );

  // Clear any pending scroll timers when the panel unmounts so they don't
  // fire after the FlatList ref has been torn down.
  useEffect(() => {
    return () => {
      scrollTimersRef.current.forEach(clearTimeout);
      scrollTimersRef.current.clear();
    };
  }, []);

  const markRead = useCallback(
    (messageId: string | undefined) => {
      if (!messageId) return;
      if (lastMarkedReadIdRef.current === messageId) return;
      lastMarkedReadIdRef.current = messageId;
      socket.emit(CLIENT_EVENTS.MARK_READ, { tripId, messageId });
    },
    [socket, tripId],
  );

  // -------------------------------------------------------------------------
  // Join trip room and wire up events
  // -------------------------------------------------------------------------
  useEffect(() => {
    setLoading(true);
    setErrorMessage(null);
    setHasMore(false);
    setLoadingOlder(false);
    lastMarkedReadIdRef.current = null;

    const joinAndListen = () => {
      socket.emit(CLIENT_EVENTS.JOIN_TRIP, tripId);
    };

    const onHistoryPage = (payload: {
      tripId: string;
      messages: ChatMessage[];
      hasMore: boolean;
      initial?: boolean;
    }) => {
      if (payload.tripId !== tripId) return;
      if (payload.initial) {
        setMessages(payload.messages);
        setHasMore(payload.hasMore);
        setErrorMessage(null);
        setLoading(false);
        // Pin the separator to the oldest unread message at open time. If the
        // unread count exceeds the loaded tail (possible when unread > page
        // size), anchor to the oldest loaded message so the user still sees
        // "New messages" — loading older pages prepends above, which is the
        // desired visual.
        const initialUnread = initialUnreadCountRef.current;
        if (initialUnread > 0 && payload.messages.length > 0) {
          const idx = Math.max(0, payload.messages.length - initialUnread);
          setFirstUnreadId(payload.messages[idx]?.id ?? null);
        }
        const tail = payload.messages[payload.messages.length - 1];
        if (tail) markRead(tail.id);
        scheduleScrollToEnd(100, false);
      } else {
        // Older page: prepend without scrolling
        setMessages((prev) => [...payload.messages, ...prev]);
        setHasMore(payload.hasMore);
        setLoadingOlder(false);
      }
    };

    const onNewMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      scheduleScrollToEnd(50, true);
      // Watermark-gated: only emit MARK_READ when the visible tail advances.
      markRead(msg.id);
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

    socket.on(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, onHistoryPage);
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
      socket.off(SERVER_EVENTS.MESSAGE_HISTORY_PAGE, onHistoryPage);
      socket.off(SERVER_EVENTS.NEW_MESSAGE, onNewMessage);
      socket.off(SERVER_EVENTS.UNREAD_COUNT, onUnreadCount);
      socket.off(SERVER_EVENTS.ERROR, onChatError);
      socket.off('connect', joinAndListen);
      socket.off('connect_error', onConnectError);
    };
  }, [socket, tripId, onUnreadChange, markRead, scheduleScrollToEnd]);

  // -------------------------------------------------------------------------
  // Load older page on demand
  // -------------------------------------------------------------------------
  const loadOlder = useCallback(() => {
    if (!hasMore || loadingOlder) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingOlder(true);
    socket.emit(CLIENT_EVENTS.LOAD_OLDER, { tripId, beforeId: oldest.id });
  }, [hasMore, loadingOlder, messages, socket, tripId]);

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
    const showUnreadSeparator = firstUnreadId !== null && item.id === firstUnreadId;
    return (
      <View>
        {showUnreadSeparator && (
          <View
            style={themedStyles.unreadSeparator}
            testID="chat-unread-separator"
            accessibilityRole={Platform.OS === 'web' ? ('separator' as any) : undefined}
            accessibilityLabel="New messages below"
          >
            <View style={themedStyles.unreadSeparatorLine} />
            <Text style={themedStyles.unreadSeparatorLabel}>New messages</Text>
            <View style={themedStyles.unreadSeparatorLine} />
          </View>
        )}
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
          keyExtractor={(item: ChatMessage) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={themedStyles.messageList}
          ListHeaderComponent={
            hasMore ? (
              <TouchableOpacity
                onPress={loadOlder}
                disabled={loadingOlder}
                style={themedStyles.loadOlderBtn}
                testID="chat-load-older"
                accessibilityRole="button"
                accessibilityLabel="Load older messages"
              >
                {loadingOlder ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={themedStyles.loadOlderText}>Load older messages</Text>
                )}
              </TouchableOpacity>
            ) : null
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
  loadOlderBtn: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: theme?.colors.surfaceMuted ?? '#ececec',
  },
  loadOlderText: {
    color: theme?.colors.textMuted ?? '#555',
    fontSize: 12,
    fontWeight: '600',
  },
  unreadSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
    gap: 8,
  },
  unreadSeparatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme?.colors.error ?? '#d32f2f',
    opacity: 0.4,
  },
  unreadSeparatorLabel: {
    color: theme?.colors.error ?? '#d32f2f',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
