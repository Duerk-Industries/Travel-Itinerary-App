import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { shadowStyle } from '../utils/shadowStyle';
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
  const _styleTheme = useStyleTheme();
  const accessibilityLabel =
    unreadCount > 0
      ? `Open trip chat, ${unreadCount > 99 ? 'over 99' : unreadCount} unread`
      : 'Open trip chat';
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles(_styleTheme).fab}
      testID="chat-fab"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles(_styleTheme).icon} accessibilityElementsHidden importantForAccessibility="no">💬</Text>
      {unreadCount > 0 && (
        <View style={styles(_styleTheme).badge} testID="chat-unread-badge" accessibilityElementsHidden importantForAccessibility="no">
          <Text style={styles(_styleTheme).badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_ChatButton_1', { StyleSheet: StyleSheet, shadowStyle: shadowStyle }, _theme);

export default ChatButton;
