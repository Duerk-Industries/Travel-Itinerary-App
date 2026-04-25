/**
 * ChatButton — floating action button (lower-right) that opens the ChatPanel.
 * Shows an unread badge when there are unread messages.
 */
import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';

interface Props {
  onPress: () => void;
  unreadCount: number;
}

const ChatButton: React.FC<Props> = ({ onPress, unreadCount }) => {
  const accessibilityLabel =
    unreadCount > 0
      ? `Open trip chat, ${unreadCount > 99 ? 'over 99' : unreadCount} unread`
      : 'Open trip chat';
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.fab}
      testID="chat-fab"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">💬</Text>
      {unreadCount > 0 && (
        <View style={styles.badge} testID="chat-unread-badge" accessibilityElementsHidden importantForAccessibility="no">
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute' as any,
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1565C0',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    zIndex: 1000,
  },
  icon: {
    fontSize: 24,
  },
  badge: {
    position: 'absolute' as any,
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});

export default ChatButton;
