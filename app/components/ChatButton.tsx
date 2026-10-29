import { shadowStyle } from '../utils/shadowStyle';
/**
 * ChatButton — floating action button (lower-right) that opens the ChatPanel.
 * Shows an unread badge when there are unread messages.
 */
import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { gradientFill } from '../theme/theme';
import { useFloatingInset } from '../contexts/FloatingInsetContext';
import Icon from './Icon';

interface Props {
  onPress: () => void;
  unreadCount: number;
}

const ChatButton: React.FC<Props> = ({ onPress, unreadCount }) => {
  const floatingInset = useFloatingInset();
  const accessibilityLabel =
    unreadCount > 0
      ? `Open trip chat, ${unreadCount > 99 ? 'over 99' : unreadCount} unread`
      : 'Open trip chat';
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.fab, floatingInset ? { bottom: 24 + floatingInset } : null]}
      testID="chat-fab"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon name="chat" color="#FFFFFF" size={24} />
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
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    // Graphite with a soft gradient and a hairline edge, so it reads on white and on black.
    backgroundColor: '#141414',
    ...gradientFill(['#2B2B2B', '#050505']),
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    ...shadowStyle('#000', 0.2, 0, 3, 6),
    zIndex: 1000,
  },
  icon: {
    fontSize: 24,
  },
  badge: {
    position: 'absolute',
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
