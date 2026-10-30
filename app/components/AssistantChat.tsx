import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
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

import type { ActionDispatchContext } from '../utils/assistantTools';
import type { Tour } from '../tabs/activities';
import AssistantChatButton from './AssistantChatButton';
import { detectAssistantModelCapability } from '../utils/assistantLocalModel';

const AssistantChatPanel = lazy(() => import('./AssistantChatPanel'));

type Props = {
  theme?: AppTheme;
  userId?: string | null;
  // Action mode -- see AssistantChatPanel.tsx and useAssistantChat.ts.
  // Threading these through a static import here (rather than only inside
  // the lazy-loaded panel) is safe: they're plain data (a boolean, a
  // context object, an array), never anything that imports WebLLM.
  actionsAllowed?: boolean;
  dispatchContext?: ActionDispatchContext | null;
  activities?: Tour[];
};

const PanelLoadingFallback: React.FC = () => { const _styleTheme = useStyleTheme(); return ((
  <View style={styles(_styleTheme).fallback} testID="assistant-chunk-loading">
    <ActivityIndicator />
  </View>
)); };

const AssistantChat: React.FC<Props> = ({ theme: _providedTheme, userId, actionsAllowed, dispatchContext, activities }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  // Two flags, not one: `hasOpenedOnce` is sticky (never goes back to
  // false) so the panel -- and the useAssistantChat() state living inside
  // it, i.e. the loaded model + the conversation so far -- stays mounted
  // once loaded, instead of being torn down and losing the conversation
  // every time the user closes the panel. `visible` just toggles whether
  // it's shown. The lazy import() still only ever fires once, on the
  // first open, exactly as before.
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
  const [visible, setVisible] = useState(false);
  const [capability] = useState(detectAssistantModelCapability);

  const handleOpen = () => {
    setHasOpenedOnce(true);
    setVisible(true);
  };
  const handleClose = () => setVisible(false);

  if (!capability.supported) return null;

  return (
    <>
      {!visible && <AssistantChatButton onPress={handleOpen} />}
      {hasOpenedOnce && (
        <Suspense fallback={<PanelLoadingFallback />}>
          <AssistantChatPanel
            onClose={handleClose}
            theme={theme}
            visible={visible}
            userId={userId}
            actionsAllowed={actionsAllowed}
            dispatchContext={dispatchContext}
            activities={activities}
          />
        </Suspense>
      )}
    </>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_AssistantChat_1', { StyleSheet: StyleSheet }, _theme);

export default AssistantChat;
