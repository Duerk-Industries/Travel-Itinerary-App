import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { shadowStyle } from '../utils/shadowStyle';
/**
 * AssistantChatButton — floating action button (lower-left) that opens the
 * on-device AI guide assistant. Deliberately imports nothing from
 * assistantLocalModel.ts / @mlc-ai/web-llm -- this button must stay cheap
 * and always-mounted; only AssistantChatPanel (lazy-loaded, and only once
 * this button is pressed) pulls in the heavy on-device model dependency.
 * See "Lazy load" in docs/implementation_plans/implementation-plan-ai-assistant.md.
 *
 * Positioned lower-left (mirrored from ChatButton's lower-right) so it
 * doesn't collide with the trip group-chat FAB.
 */
import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { useFloatingInset } from '../contexts/FloatingInsetContext';
import Icon from './Icon';

interface Props {
  onPress: () => void;
}

const AssistantChatButton: React.FC<Props> = ({ onPress }) => {
  const _styleTheme = useStyleTheme();
  const floatingInset = useFloatingInset();
  return (
  <TouchableOpacity
    onPress={onPress}
    style={[styles(_styleTheme).fab, floatingInset ? themeStyle('components_AssistantChatButton_2', { floatingInset: floatingInset }, _styleTheme) : null]}
    testID="assistant-chat-fab"
    accessibilityRole="button"
    accessibilityLabel="Open the app guide assistant"
  >
    <Icon name="sparkle" color={themeStyle('components_AssistantChatButton_3', {  }, _styleTheme)} size={24} />
  </TouchableOpacity>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_AssistantChatButton_1', { StyleSheet: StyleSheet, shadowStyle: shadowStyle }, _theme);

export default AssistantChatButton;
