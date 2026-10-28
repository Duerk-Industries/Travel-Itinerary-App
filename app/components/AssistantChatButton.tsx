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
import { gradientFill } from '../theme/theme';
import { useFloatingInset } from '../contexts/FloatingInsetContext';
import Icon from './Icon';

interface Props {
  onPress: () => void;
}

const AssistantChatButton: React.FC<Props> = ({ onPress }) => {
  const floatingInset = useFloatingInset();
  return (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.fab, floatingInset ? { bottom: 24 + floatingInset } : null]}
    testID="assistant-chat-fab"
    accessibilityRole="button"
    accessibilityLabel="Open the app guide assistant"
  >
    <Icon name="sparkle" color="#FFFFFF" size={24} />
  </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
    left: 20,
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
});

export default AssistantChatButton;
