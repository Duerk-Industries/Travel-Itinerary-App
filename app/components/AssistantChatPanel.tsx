import { layoutMetrics, resolveComponentTheme as resolveStyleTheme, themeStyle, getAppTheme as getStyleTheme, type AppTheme } from '../theme/theme';


import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import KeyboardViewport from './KeyboardViewport';
import { shadowStyle } from '../utils/shadowStyle';
/**
 * AssistantChatPanel — the on-device guide assistant's chat UI.
 *
 * This is the module that actually pulls in @mlc-ai/web-llm (via
 * useAssistantChat -> assistantLocalModel.ts). It must only ever be
 * reached through AssistantChat.tsx's React.lazy() boundary -- see the
 * hard rule in "Maintainability" in
 * docs/implementation_plans/implementation-plan-ai-assistant.md. A single
 * static import of this file from anywhere else would silently pull the
 * ~5.75MB WebLLM bundle back into the app's initial page load.
 *
 * Desktop/web: partial-screen panel anchored to the bottom-left (mirrors
 *              ChatPanel.tsx's bottom-right group-chat panel).
 * Mobile: full-screen (not reachable yet -- native ships flag-off, see the
 *         plan -- but the layout is here for when Phase 4 lands).
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
} from 'react-native';

import { useAssistantChat, type AssistantChatUIMessage } from '../hooks/useAssistantChat';
import { DEFAULT_MODEL_ID, HIGH_QUALITY_MODEL_ID } from '../utils/assistantLocalModel';
import type { ActionDispatchContext } from '../utils/assistantTools';
import type { Tour } from '../tabs/activities';
import AssistantActionConfirmDialog from './AssistantActionConfirmDialog';
import {
  clampPanelPosition,
  computeInitialPanelPosition,
  getViewportSize,
  type PanelPosition,
} from '../utils/draggablePanelPosition';

interface Props {
  onClose: () => void;
  theme?: AppTheme;
  // Controls visibility without unmounting -- see AssistantChat.tsx. This
  // component (and the useAssistantChat() state inside it -- the loaded
  // model and the conversation so far) stays mounted across close/reopen
  // so the conversation isn't lost just because the panel was closed.
  visible?: boolean;
  // Scopes conversation persistence to this account (see
  // assistantChatHistoryStorage.ts) so two accounts sharing a browser
  // don't see each other's history. Persistence is skipped entirely when
  // this is null/undefined.
  userId?: string | null;
  // Action mode (ai_assistant_actions), independently flagged from guide
  // mode -- see useAssistantChat.ts. False/omitted behaves exactly like
  // before this existed.
  actionsAllowed?: boolean;
  // Only meaningful when actionsAllowed is true -- what a confirmed
  // proposal actually dispatches through. See assistantTools.ts.
  dispatchContext?: ActionDispatchContext | null;
  // The trip's current activities, for the updateItineraryStatus picker.
  // Sourced from App.tsx's existing `tours` state, not a fresh fetch --
  // see the implementation plan's Milestone 5.
  activities?: Tour[];
}

const PANEL_WIDTH = layoutMetrics.AssistantChatPanel_PANEL_WIDTH;
const PANEL_HEIGHT = layoutMetrics.AssistantChatPanel_PANEL_HEIGHT;

const getResponsivePanelWidth = (): number => {
  if (typeof window !== 'undefined' && window.innerWidth) {
    return Math.min(PANEL_WIDTH, window.innerWidth - 32);
  }
  return PANEL_WIDTH;
};

const CAPABILITY_REASON_TEXT: Record<string, string> = {
  'no-webgpu':
    'This assistant needs a browser with WebGPU support, like a recent version of Chrome or Edge on desktop.',
  'not-web': 'This assistant is only available on desktop web browsers for now.',
  phone: 'This assistant is only available on desktop web browsers for now.',
  unknown: "This assistant isn't available on this browser or device right now.",
};

const AssistantChatPanel: React.FC<Props> = ({
  onClose,
  theme: _providedTheme,
  visible = true,
  userId,
  actionsAllowed = false,
  dispatchContext = null,
  activities = [],
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const themedStyles = React.useMemo(() => buildStyles(theme), [theme]);
  const {
    engineState,
    loadProgress,
    errorMessage,
    messages,
    capability,
    pendingAction,
    isConfirmingAction,
    loadModel,
    sendMessage,
    clearConversation,
    confirmPendingAction,
    cancelPendingAction,
  } = useAssistantChat({ userId, actionsAllowed, dispatchContext });
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<any>(null);
  const isWeb = Platform.OS === 'web';
  const hasStartedConversation = messages.length > 0;

  // Draggable position -- see "blocks the screen" feedback from manual
  // testing (docs/implementation_plans/implementation-plan-ai-assistant.md,
  // Phase 1 findings): the panel was pinned to a fixed spot with no way to
  // move it out of the way of whatever it happened to sit on top of. This
  // state (and the position the user drags it to) lives in this component,
  // so it survives close/reopen the same way the conversation does -- see
  // the `visible` prop doc above.
  // Action mode loads the larger, opt-in model (Qwen2.5-3B), not the shared
  // default (1.5B) -- the accuracy checkpoint that actually unblocked Phase
  // 3 (implementation plan, "Narrow-tool-set retest result": 9/10) was
  // measured against 3B specifically. 1.5B only ever scored 3/8 on the same
  // prompts and was never the validated choice for actions; it stayed the
  // shared default for guide mode's smaller/faster download, which doesn't
  // carry the same accuracy bar. Guide-only sessions are unaffected.
  const modelToLoad = actionsAllowed ? HIGH_QUALITY_MODEL_ID : DEFAULT_MODEL_ID;
  const panelSize = React.useMemo(() => (themeStyle('components_AssistantChatPanel_1', { getResponsivePanelWidth: getResponsivePanelWidth, PANEL_HEIGHT: PANEL_HEIGHT }, (theme ?? _styleTheme))), [_styleTheme]);
  const [position, setPosition] = useState<PanelPosition>(() =>
    computeInitialPanelPosition(getViewportSize(), panelSize)
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{ startPageX: number; startPageY: number; startTop: number; startLeft: number } | null>(
    null
  );

  // Re-clamp on resize so a panel dragged near an edge doesn't end up
  // partly or fully off-screen if the window shrinks afterward.
  useEffect(() => {
    if (typeof window === 'undefined' || !isWeb) return undefined;
    const handleResize = () => {
      setPosition((prev) => clampPanelPosition(prev, getViewportSize(), panelSize));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isWeb, panelSize]);

  const handleDragGrant = useCallback(
    (evt: any) => {
      const { pageX, pageY } = evt.nativeEvent;
      dragStateRef.current = { startPageX: pageX, startPageY: pageY, startTop: position.top, startLeft: position.left };
      setIsDragging(true);
    },
    [position]
  );

  const handleDragMove = useCallback(
    (evt: any) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const { pageX, pageY } = evt.nativeEvent;
      const next = themeStyle('components_AssistantChatPanel_2', { drag: drag, pageY: pageY, pageX: pageX }, (theme ?? _styleTheme));
      setPosition(clampPanelPosition(next, getViewportSize(), panelSize));
    },
    [panelSize, _styleTheme]
  );

  const handleDragRelease = useCallback(() => {
    dragStateRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (messages.length) {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    void sendMessage(text);
  }, [inputText, sendMessage]);

  const renderMessage = ({ item }: { item: AssistantChatUIMessage }) => {
    const isUser = item.role === 'user';
    const isPendingAssistantReply = !isUser && item.content === '' && engineState === 'generating';
    return (
      <View
        style={[themedStyles.messageRow, isUser ? themedStyles.ownRow : themedStyles.otherRow]}
        testID={`assistant-message-${item.id}`}
      >
        <View style={[themedStyles.bubble, isUser ? themedStyles.ownBubble : themedStyles.otherBubble]}>
          {isPendingAssistantReply ? (
            <ActivityIndicator size="small" color={theme?.colors.textMuted ?? themeStyle('components_AssistantChatPanel_5', {  }, (theme ?? _styleTheme))} />
          ) : (
            <Text style={isUser ? themedStyles.ownText : themedStyles.otherText}>{item.content}</Text>
          )}
        </View>
      </View>
    );
  };

  // Only the desktop/web layout is draggable -- panelMobile is full-screen
  // (not reachable yet, see the file header comment), where "position"
  // isn't a meaningful concept.
  const panelStyle = isWeb ? [themedStyles.panelDesktop, position] : themedStyles.panelMobile;

  const renderBody = () => {
    if (!capability.supported) {
      return (
        <View style={themedStyles.stateContainer} testID="assistant-unsupported-state">
          <Text style={themedStyles.stateTitle}>Not available here</Text>
          <Text style={themedStyles.stateBody}>
            {CAPABILITY_REASON_TEXT[capability.reason ?? 'unknown'] ?? CAPABILITY_REASON_TEXT.unknown}
          </Text>
        </View>
      );
    }

    if (engineState === 'idle' || (engineState === 'error' && !hasStartedConversation)) {
      return (
        <View style={themedStyles.stateContainer} testID="assistant-idle-state">
          <Text style={themedStyles.stateTitle}>Ask about any feature in the app</Text>
          <Text style={themedStyles.stateBody}>
            This assistant runs entirely on your device -- nothing you ask ever leaves it. Setting it up
            takes a little while and happens once per browser session (not once per message) -- the
            model download itself is cached, but your browser still has to prepare it for your GPU each
            time you open a fresh tab.
          </Text>
          {errorMessage ? (
            <Text style={[themedStyles.stateBody, themedStyles.errorText]}>{errorMessage}</Text>
          ) : null}
          <TouchableOpacity
            style={themedStyles.primaryButton}
            onPress={() => void loadModel(modelToLoad)}
            testID="assistant-load-button"
            accessibilityRole="button"
          >
            <Text style={themedStyles.primaryButtonText}>
              {errorMessage ? 'Try again' : 'Load assistant'}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (engineState === 'loading') {
      const pct = Math.round((loadProgress?.progress ?? 0) * 100);
      return (
        <View style={themedStyles.stateContainer} testID="assistant-loading-state">
          <ActivityIndicator />
          <Text style={themedStyles.stateBody}>{loadProgress?.text || 'Loading assistant…'}</Text>
          <View style={themedStyles.progressTrack}>
            <View style={[themedStyles.progressFill, themeStyle('components_AssistantChatPanel_3', { pct: pct }, (theme ?? _styleTheme))]} />
          </View>
        </View>
      );
    }

    // ready | generating | error-with-history
    return (
      <>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item: AssistantChatUIMessage) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={themedStyles.messageList}
          testID="assistant-message-list"
        />
        <AssistantActionConfirmDialog
          visible={!!pendingAction}
          pendingAction={pendingAction}
          activities={activities}
          confirming={isConfirmingAction}
          onConfirm={(resolvedActivityId) => void confirmPendingAction(resolvedActivityId)}
          onCancel={cancelPendingAction}
          theme={theme}
        />
        {errorMessage ? (
          <Text style={[themedStyles.stateBody, themedStyles.errorText, themedStyles.inlineError]}>
            {errorMessage}
          </Text>
        ) : null}
        <View style={themedStyles.inputRow}>
          <TextInput
            style={themedStyles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask how to do something…"
            placeholderTextColor={theme?.colors.textMuted ?? themeStyle('components_AssistantChatPanel_6', {  }, (theme ?? _styleTheme))}
            multiline
            maxLength={1000}
            editable={engineState !== 'generating'}
            onSubmitEditing={isWeb ? handleSend : undefined}
            blurOnSubmit={false}
            testID="assistant-input"
          />
          <TouchableOpacity
            onPress={handleSend}
            style={[
              themedStyles.sendBtn,
              (!inputText.trim() || engineState === 'generating') && themedStyles.sendBtnDisabled,
            ]}
            disabled={!inputText.trim() || engineState === 'generating'}
            testID="assistant-send"
          >
            <Text style={themedStyles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
        <Text style={themedStyles.footerNote}>Runs on your device. Your questions never leave it.</Text>
      </>
    );
  };

  // Rendered after every hook above, so useAssistantChat()'s state (the
  // loaded engine, the conversation) survives being hidden -- this
  // component stays mounted, it just paints nothing while closed.
  if (!visible) return null;

  return (
    <KeyboardViewport
      style={[themedStyles.container, panelStyle]}
      testID="assistant-chat-panel"
    >
      <View style={themedStyles.header}>
        {!isWeb && (
          <TouchableOpacity onPress={onClose} style={themedStyles.headerBtn} testID="assistant-back">
            <Text style={themedStyles.headerBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <View
          style={[themedStyles.headerTitleDragHandle, isDragging && themedStyles.headerTitleDragging]}
          testID="assistant-drag-handle"
          {...(isWeb
            ? {
                onStartShouldSetResponder: () => true,
                onResponderGrant: handleDragGrant,
                onResponderMove: handleDragMove,
                onResponderRelease: handleDragRelease,
                onResponderTerminate: handleDragRelease,
              }
            : null)}
        >
          <Text style={themedStyles.headerTitle}>{isWeb ? '⠿⠿ App Guide' : 'App Guide'}</Text>
        </View>
        {hasStartedConversation && (
          <TouchableOpacity
            onPress={clearConversation}
            style={themedStyles.headerBtn}
            testID="assistant-clear"
            accessibilityRole="button"
            accessibilityLabel="Clear conversation"
          >
            <Text style={themedStyles.headerBtnText}>🗑</Text>
          </TouchableOpacity>
        )}
        {isWeb && (
          <TouchableOpacity onPress={onClose} style={themedStyles.headerBtn} testID="assistant-close">
            <Text style={themedStyles.headerBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      {renderBody()}
    </KeyboardViewport>
  );
};

const buildStyles = (theme?: AppTheme) => StyleSheet.create(themeStyle('components_AssistantChatPanel_4', { theme: theme, shadowStyle: shadowStyle, getResponsivePanelWidth: getResponsivePanelWidth, PANEL_HEIGHT: PANEL_HEIGHT }, (theme ?? getStyleTheme('light', 'light'))));

export default AssistantChatPanel;
