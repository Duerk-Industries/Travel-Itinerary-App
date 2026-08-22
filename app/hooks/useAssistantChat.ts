import { useCallback, useEffect, useRef, useState } from 'react';
import type { MLCEngine } from '@mlc-ai/web-llm';
import {
  DEFAULT_MODEL_ID,
  MAX_REPLY_TOKENS,
  MODEL_CONTEXT_WINDOW_TOKENS,
  detectAssistantModelCapability,
  loadAssistantEngine,
  streamAssistantReply,
  type AssistantChatMessage,
  type AssistantEngineLoadProgress,
  type AssistantModelCapability,
} from '../utils/assistantLocalModel';
import { retrieveRelevantGuideEntries } from '../utils/assistantGuideCorpus';
import { buildAssistantSystemPrompt, pruneHistoryToTokenBudget } from '../utils/assistantPrompt';
import {
  clearStoredConversation,
  loadStoredConversation,
  persistConversation,
  type AssistantChatUIMessage,
} from '../utils/assistantChatHistoryStorage';

export type { AssistantChatUIMessage };

export type AssistantChatEngineState = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

// Turns per conversation is capped so a very long back-and-forth can't make
// an underpowered device unresponsive (see "Runaway-context guards" in the
// implementation plan) -- independent of the token-budget pruning below,
// which bounds a single request, not the whole session.
export const MAX_CONVERSATION_MESSAGES = 20;

let idCounter = 0;
const nextId = (prefix: string): string => {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
};

export const useAssistantChat = (userId?: string | null) => {
  const [engineState, setEngineState] = useState<AssistantChatEngineState>('idle');
  const [loadProgress, setLoadProgress] = useState<AssistantEngineLoadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Restored once, synchronously, from this device's local storage -- see
  // assistantChatHistoryStorage.ts for why this is client-only, never a
  // server call.
  const [messages, setMessages] = useState<AssistantChatUIMessage[]>(() => loadStoredConversation(userId));
  const [capability] = useState<AssistantModelCapability>(() => detectAssistantModelCapability());
  const engineRef = useRef<MLCEngine | null>(null);

  // Tracks which userId `messages` currently reflects a successful load
  // for. Seeded from whatever `userId` was at mount, matching the lazy
  // useState above, so the common case (userId already available at
  // mount) neither re-loads nor delays persistence.
  //
  // If `userId` only becomes available *after* mount -- a real gap: this
  // app decodes/restores it asynchronously during session restore, not
  // always in the very first render -- the effect below catches up.
  const hydratedUserIdRef = useRef<string | null>(userId ?? null);

  useEffect(() => {
    if (!userId || hydratedUserIdRef.current === userId) return;
    hydratedUserIdRef.current = userId;
    setMessages(loadStoredConversation(userId));
  }, [userId]);

  // Persist once a turn settles (not on every streamed token -- `messages`
  // changes on every delta while generating, and writing to localStorage
  // that often would be wasteful).
  //
  // Gated on having actually hydrated for the *current* userId first.
  // Without this guard: if userId becomes available only after mount, this
  // effect fires anyway (userId is a dependency) while `messages` is still
  // the pre-hydration `[]`, silently overwriting that user's real stored
  // conversation with nothing. This was a real bug, not a hypothetical --
  // found via manual testing where a page reload appeared to lose a
  // conversation that had been correctly written in the prior session.
  useEffect(() => {
    if (engineState === 'generating') return;
    if (hydratedUserIdRef.current !== userId) return;
    persistConversation(userId, messages);
  }, [messages, engineState, userId]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    clearStoredConversation(userId);
  }, [userId]);

  const loadModel = useCallback(async (modelId: string = DEFAULT_MODEL_ID) => {
    if (!capability.supported) return;
    setEngineState('loading');
    setErrorMessage(null);
    setLoadProgress(null);
    try {
      const engine = await loadAssistantEngine(modelId, (report) => setLoadProgress(report));
      engineRef.current = engine;
      setEngineState('ready');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load the assistant.');
      setEngineState('error');
    }
  }, [capability.supported]);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      const engine = engineRef.current;
      if (!text || !engine || engineState === 'generating' || engineState === 'loading') return;
      if (messages.length >= MAX_CONVERSATION_MESSAGES) {
        setErrorMessage('This conversation has reached its length limit. Close and reopen the assistant to start a new one.');
        return;
      }

      const userMessage: AssistantChatUIMessage = { id: nextId('u'), role: 'user', content: text };
      const assistantMessageId = nextId('a');
      setMessages((prev) => [...prev, userMessage, { id: assistantMessageId, role: 'assistant', content: '' }]);
      setEngineState('generating');
      setErrorMessage(null);

      try {
        const retrieved = retrieveRelevantGuideEntries(text);
        const systemPrompt = buildAssistantSystemPrompt(retrieved);
        const budget = MODEL_CONTEXT_WINDOW_TOKENS - MAX_REPLY_TOKENS;
        const historyBudget = [...messages, userMessage];
        const prunedHistory = pruneHistoryToTokenBudget(historyBudget, budget);

        const engineMessages: AssistantChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...prunedHistory.map((m) => ({ role: m.role, content: m.content })),
        ];

        await streamAssistantReply(engine, engineMessages, (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMessageId ? { ...m, content: m.content + delta } : m))
          );
        });
        setEngineState('ready');
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Something went wrong generating a response.');
        setEngineState('error');
      }
    },
    [engineState, messages]
  );

  return {
    engineState,
    loadProgress,
    errorMessage,
    messages,
    capability,
    loadModel,
    sendMessage,
    clearConversation,
  };
};
