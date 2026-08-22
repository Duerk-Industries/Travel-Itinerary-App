/**
 * AssistantChat — composition root for the on-device guide assistant.
 *
 * Mirrors ChatOverlay.tsx's button/panel split, with one deliberate
 * difference: AssistantChatPanel is lazy-loaded HERE, one level below this
 * component, rather than this whole component being lazy from App.tsx.
 *
 * Why: ChatOverlay itself is unconditionally mounted in App.tsx's render
 * tree. If *this* component were the lazy() boundary and were mounted
 * unconditionally the same way, React would kick off the
 * import('@mlc-ai/web-llm') chunk fetch on every app load, regardless of
 * whether the user ever opens the assistant -- exactly the mistake the
 * Phase 0 spike's first (wrong) test made. Keeping AssistantChatButton a
 * cheap, non-lazy, always-mounted component and only lazy-loading
 * AssistantChatPanel -- which is itself only rendered once `open` is
 * true -- means the WebLLM bundle is fetched on first tap, not on boot.
 * See "Lazy load" in
 * docs/implementation_plans/implementation-plan-ai-assistant.md.
 */
import React, { Suspense, lazy, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import type { AppTheme } from '../theme/theme';
import AssistantChatButton from './AssistantChatButton';

const AssistantChatPanel = lazy(() => import('./AssistantChatPanel'));

type Props = {
  theme?: AppTheme;
  userId?: string | null;
};

const PanelLoadingFallback: React.FC = () => (
  <View style={styles.fallback} testID="assistant-chunk-loading">
    <ActivityIndicator />
  </View>
);

const AssistantChat: React.FC<Props> = ({ theme, userId }) => {
  // Two flags, not one: `hasOpenedOnce` is sticky (never goes back to
  // false) so the panel -- and the useAssistantChat() state living inside
  // it, i.e. the loaded model + the conversation so far -- stays mounted
  // once loaded, instead of being torn down and losing the conversation
  // every time the user closes the panel. `visible` just toggles whether
  // it's shown. The lazy import() still only ever fires once, on the
  // first open, exactly as before.
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const [visible, setVisible] = useState(false);

  const handleOpen = () => {
    setHasOpenedOnce(true);
    setVisible(true);
  };
  const handleClose = () => setVisible(false);

  return (
    <>
      {!visible && <AssistantChatButton onPress={handleOpen} />}
      {hasOpenedOnce && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <AssistantChatPanel onClose={handleClose} theme={theme} visible={visible} userId={userId} />
        </Suspense>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  fallback: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
});

export default AssistantChat;
