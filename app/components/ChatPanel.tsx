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

interface Props {
  socket: Socket;
  tripId: string;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onMinimize?: () => void;
  unreadCount: number;
  onUnreadChange: (count: number) => void;
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
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);
  const isWeb = Platform.OS === 'web';

  // -------------------------------------------------------------------------
  // Join trip room and wire up events
  // -------------------------------------------------------------------------
  useEffect(() => {
    const joinAndListen = () => {
      socket.emit(CLIENT_EVENTS.JOIN_TRIP, tripId);
    };

    const onHistory = (history: ChatMessage[]) => {
      setMessages(history);
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

    socket.on(SERVER_EVENTS.MESSAGE_HISTORY, onHistory);
    socket.on(SERVER_EVENTS.NEW_MESSAGE, onNewMessage);
    socket.on(SERVER_EVENTS.UNREAD_COUNT, onUnreadCount);

    // Join now if already connected, otherwise join when connection establishes
    if (socket.connected) {
      joinAndListen();
    }
    socket.on('connect', joinAndListen);

    return () => {
      socket.off(SERVER_EVENTS.MESSAGE_HISTORY, onHistory);
      socket.off(SERVER_EVENTS.NEW_MESSAGE, onNewMessage);
      socket.off(SERVER_EVENTS.UNREAD_COUNT, onUnreadCount);
      socket.off('connect', joinAndListen);
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
        style={[styles.messageRow, isOwn ? styles.ownRow : styles.otherRow]}
        testID={`chat-message-${item.id}`}
      >
        {!isOwn && (
          <View style={[styles.avatarSmall, { backgroundColor: '#9e9e9e' }]}>
            <Text style={styles.avatarText}>{item.senderInitials}</Text>
          </View>
        )}
        <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
          {!isOwn && (
            <Text style={styles.senderName}>{item.senderName}</Text>
          )}
          <Text style={isOwn ? styles.ownText : styles.otherText}>{item.body}</Text>
          <Text style={styles.timestamp}>
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
    ? styles.panelDesktop
    : styles.panelMobile;

  return (
    <KeyboardAvoidingView
      style={[styles.container, panelStyle]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="chat-panel"
    >
      {/* Header */}
      <View style={styles.header}>
        {!isWeb && (
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} testID="chat-back">
            <Text style={styles.headerBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Trip Chat</Text>
        {isWeb && onMinimize && (
          <TouchableOpacity onPress={onMinimize} style={styles.headerBtn} testID="chat-minimize">
            <Text style={styles.headerBtnText}>—</Text>
          </TouchableOpacity>
        )}
        {isWeb && (
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} testID="chat-close">
            <Text style={styles.headerBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Message list */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
          testID="chat-message-list"
        />
      )}

      {/* Input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
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
          style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
          disabled={!inputText.trim()}
          testID="chat-send"
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
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
    borderColor: '#e0e0e0',
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
    backgroundColor: '#f0f0f0',
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#555',
    marginBottom: 2,
  },
  ownText: {
    color: '#fff',
    fontSize: 14,
  },
  otherText: {
    color: '#1a1a1a',
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
    borderTopColor: '#e0e0e0',
    padding: 8,
    backgroundColor: '#fafafa',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#1a1a1a',
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#1565C0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnDisabled: {
    backgroundColor: '#bdbdbd',
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});

export default ChatPanel;
