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
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import type { AppTheme } from '../theme/theme';
import { useAssistantChat, type AssistantChatUIMessage } from '../hooks/useAssistantChat';
import { DEFAULT_MODEL_ID } from '../utils/assistantLocalModel';
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
}

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;

const getResponsivePanelWidth = (): number => {
  if (typeof window !== 'undefined' && window.innerWidth) {
    return Math.min(PANEL_WIDTH, window.innerWidth - 32);
  }
  return PANEL_WIDTH;
};

const CAPABILITY_REASON_TEXT: Record<string, string> = {
  'no-webgpu':
    'This assistant needs a browser with WebGPU support, like a recent version of Chrome or Edge on desktop.',
  'not-web': 'This assistant is only available in the web app for now.',
  unknown: "This assistant isn't available on this browser or device right now.",
};

const AssistantChatPanel: React.FC<Props> = ({ onClose, theme, visible = true, userId }) => {
  const themedStyles = React.useMemo(() => buildStyles(theme), [theme]);
  const { engineState, loadProgress, errorMessage, messages, capability, loadModel, sendMessage, clearConversation } =
    useAssistantChat(userId);
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
  const panelSize = React.useMemo(() => ({ width: getResponsivePanelWidth(), height: PANEL_HEIGHT }), []);
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
      const next = {
        top: drag.startTop + (pageY - drag.startPageY),
        left: drag.startLeft + (pageX - drag.startPageX),
      };
      setPosition(clampPanelPosition(next, getViewportSize(), panelSize));
    },
    [panelSize]
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
            <ActivityIndicator size="small" color={theme?.colors.textMuted ?? '#7C3AED'} />
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
            onPress={() => void loadModel(DEFAULT_MODEL_ID)}
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
            <View style={[themedStyles.progressFill, { width: `${pct}%` }]} />
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
            placeholderTextColor={theme?.colors.textMuted ?? '#999'}
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
    <KeyboardAvoidingView
      style={[themedStyles.container, panelStyle]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
    </KeyboardAvoidingView>
  );
};

const buildStyles = (theme?: AppTheme) => StyleSheet.create({
  container: {
    backgroundColor: theme?.colors.surface ?? '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  panelDesktop: {
    // top/left are supplied dynamically (draggable position state) rather
    // than fixed here -- see the `position` style merged in alongside this
    // one where panelStyle is computed.
    position: 'absolute' as any,
    width: getResponsivePanelWidth(),
    height: PANEL_HEIGHT,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? '#e0e0e0',
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
    backgroundColor: '#7C3AED',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitleDragHandle: {
    flex: 1,
    cursor: 'grab' as any,
  },
  headerTitleDragging: {
    cursor: 'grabbing' as any,
  },
  headerTitle: {
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
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  stateTitle: {
    color: theme?.colors.text ?? '#1a1a1a',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    color: theme?.colors.textMuted ?? '#555',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    color: theme?.colors.error ?? '#d32f2f',
  },
  inlineError: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: '#7C3AED',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: theme?.colors.surfaceMuted ?? '#ececec',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7C3AED',
  },
  messageList: {
    padding: 10,
    paddingBottom: 4,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  ownRow: {
    justifyContent: 'flex-end',
  },
  otherRow: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 20,
    justifyContent: 'center',
  },
  ownBubble: {
    backgroundColor: '#7C3AED',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: theme?.colors.surfaceMuted ?? '#f0f0f0',
    borderBottomLeftRadius: 4,
  },
  ownText: {
    color: '#fff',
    fontSize: 14,
  },
  otherText: {
    color: theme?.colors.text ?? '#1a1a1a',
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: theme?.colors.border ?? '#e0e0e0',
    padding: 8,
    backgroundColor: theme?.colors.backgroundAlt ?? '#fafafa',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? '#ccc',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 14,
    backgroundColor: theme?.colors.surface ?? '#fff',
    color: theme?.colors.text ?? '#1a1a1a',
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#7C3AED',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnDisabled: {
    backgroundColor: theme?.mode === 'dark' ? theme.colors.surfaceMuted : '#c4b5fd',
  },
  sendBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  footerNote: {
    fontSize: 10,
    color: theme?.colors.textMuted ?? '#999',
    textAlign: 'center',
    paddingVertical: 4,
  },
});

export default AssistantChatPanel;
