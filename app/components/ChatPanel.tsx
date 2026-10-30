import IconText from './IconText';
import { layoutMetrics, resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme as getStyleTheme, type AppTheme } from '../theme/theme';


import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import KeyboardViewport from './KeyboardViewport';
import { shadowStyle } from '../utils/shadowStyle';
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
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Socket } from 'socket.io-client';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../../packages/messaging/src/events';
import type { ChatMessage } from '../../packages/messaging/src/types';


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

const PANEL_WIDTH = layoutMetrics.ChatPanel_PANEL_WIDTH;
const PANEL_HEIGHT = layoutMetrics.ChatPanel_PANEL_HEIGHT;

// Keep the desktop panel within the browser width. Phone-sized browsers use
// the full-screen layout below.
const getResponsivePanelWidth = (): number => {
  if (typeof window !== 'undefined' && window.innerWidth) {
    return Math.min(PANEL_WIDTH, window.innerWidth - 32);
  }
  return PANEL_WIDTH;
};

const mergeMessagesById = (current: ChatMessage[], incoming: ChatMessage[], prepend = false): ChatMessage[] => {
  const seen = new Set<string>();
  const ordered = prepend ? [...incoming, ...current] : [...current, ...incoming];
  return ordered.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
};

const ChatPanel: React.FC<Props> = ({
  socket,
  tripId,
  currentUserId,
  currentUserName,
  onClose,
  onMinimize,
  unreadCount,
  onUnreadChange,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
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
  const { width: viewportWidth } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const isPhoneLayout = !isWeb || viewportWidth < 600;

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
        clearTimeout(historyTimeout);
        setMessages(mergeMessagesById([], payload.messages));
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
        setMessages((prev) => mergeMessagesById(prev, payload.messages, true));
        setHasMore(payload.hasMore);
        setLoadingOlder(false);
      }
    };

    const onNewMessage = (msg: ChatMessage) => {
      setMessages((prev) => mergeMessagesById(prev, [msg]));
      scheduleScrollToEnd(50, true);
      // Watermark-gated: only emit MARK_READ when the visible tail advances.
      markRead(msg.id);
    };

    const onUnreadCount = (data: { tripId: string; count: number }) => {
      if (data.tripId === tripId) onUnreadChange(data.count);
    };

    const onChatError = (message: string) => {
      clearTimeout(historyTimeout);
      setMessages([]);
      setErrorMessage(message || 'Unable to load chat right now.');
      setLoading(false);
    };

    const onConnectError = (err: unknown) => {
      // Surfaced only to the console — the user-facing message stays generic —
      // but this is the one place that would show *why* the handshake failed
      // (auth rejection vs transport/network failure vs CORS), which is
      // otherwise invisible once this resolves to the generic banner below.
      // eslint-disable-next-line no-console
      console.warn('[chat] connect_error', err instanceof Error ? err.message : err);
      clearTimeout(historyTimeout);
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
            <View style={[themedStyles.avatarSmall, themeStyle('components_ChatPanel_1', { theme: theme }, (theme ?? _styleTheme))]}>
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
  const panelStyle = isPhoneLayout
    ? [themedStyles.panelMobile, themeStyle('components_ChatPanel_2', { isWeb: isWeb, safeAreaInsets: safeAreaInsets }, (theme ?? _styleTheme))]
    : themedStyles.panelDesktop;

  return (
    <KeyboardViewport
      style={[themedStyles.container, panelStyle]}
      testID="chat-panel"
    >
      {/* Header */}
      <View style={themedStyles.header}>
        {isPhoneLayout && (
          <TouchableOpacity onPress={onClose} style={themedStyles.headerBtn} testID="chat-back"
            accessibilityRole="button" accessibilityLabel="Close trip chat">
            <IconText style={themedStyles.headerBtnText}>← Back</IconText>
          </TouchableOpacity>
        )}
        <Text style={themedStyles.headerTitle}>Trip Chat</Text>
        {!isPhoneLayout && onMinimize && (
          <TouchableOpacity onPress={onMinimize} style={themedStyles.headerBtn} testID="chat-minimize">
            <Text style={themedStyles.headerBtnText}>—</Text>
          </TouchableOpacity>
        )}
        {!isPhoneLayout && (
          <TouchableOpacity onPress={onClose} style={themedStyles.headerBtn} testID="chat-close">
            <IconText style={themedStyles.headerBtnText}>✕</IconText>
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
          placeholderTextColor={themeStyle('components_ChatPanel_4', {  }, (theme ?? _styleTheme))}
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
    </KeyboardViewport>
  );
};

const buildStyles = (theme?: AppTheme) => StyleSheet.create(themeStyle('components_ChatPanel_3', { theme: theme, shadowStyle: shadowStyle, getResponsivePanelWidth: getResponsivePanelWidth, PANEL_HEIGHT: PANEL_HEIGHT }, (theme ?? getStyleTheme('light', 'light'))));

export default ChatPanel;
