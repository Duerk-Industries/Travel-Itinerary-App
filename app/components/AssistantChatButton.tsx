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
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

interface Props {
  onPress: () => void;
}

const AssistantChatButton: React.FC<Props> = ({ onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={styles.fab}
    testID="assistant-chat-fab"
    accessibilityRole="button"
    accessibilityLabel="Open the app guide assistant"
  >
    <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">✨</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7C3AED',
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
});

export default AssistantChatButton;
