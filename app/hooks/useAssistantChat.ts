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
import {
  ACTION_DISPATCH,
  applyActionGuard,
  buildActionSystemPrompt,
  buildActionToolsPrompt,
  parseActionToolCall,
  type ActionDispatchArgs,
  type ActionDispatchContext,
  type ActionToolName,
} from '../utils/assistantTools';

export type { AssistantChatUIMessage };

export type AssistantChatEngineState = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

// A proposed action mode tool call awaiting the mandatory confirmation step
// (see AssistantActionConfirmDialog.tsx) -- `args` is the model's raw,
// unvalidated output. Never dispatched until confirmPendingAction runs, and
// for `updateItineraryStatus`, never dispatched at all without a real
// user-picked activity id attached at confirm time (see ACTION_DISPATCH in
// assistantTools.ts) -- `args.itemName` is a hint for the picker, not a
// trusted match.
export type PendingAction = {
  kind: ActionToolName;
  args: Record<string, unknown>;
};

export type UseAssistantChatOptions = {
  userId?: string | null;
  // Action mode is additive on top of guide mode and independently flagged
  // (ai_assistant_actions) -- when false, sendMessage's behavior is
  // byte-for-byte identical to guide-mode-only, regardless of what the
  // model might otherwise have produced.
  actionsAllowed?: boolean;
  // Only required when actionsAllowed is true -- confirmPendingAction has
  // nothing to dispatch through without it. Threaded from App.tsx, which
  // already holds backendUrl/jsonHeaders/activeTripId/defaultPayerId as
  // plain in-scope values (see assistantTools.ts's ActionDispatchContext).
  dispatchContext?: ActionDispatchContext | null;
};

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

export const useAssistantChat = ({ userId, actionsAllowed = false, dispatchContext = null }: UseAssistantChatOptions = {}) => {
  const [engineState, setEngineState] = useState<AssistantChatEngineState>('idle');
  const [loadProgress, setLoadProgress] = useState<AssistantEngineLoadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Restored once, synchronously, from this device's local storage -- see
  // assistantChatHistoryStorage.ts for why this is client-only, never a
  // server call.
  const [messages, setMessages] = useState<AssistantChatUIMessage[]>(() => loadStoredConversation(userId));
  const [capability] = useState<AssistantModelCapability>(() => detectAssistantModelCapability());
  const engineRef = useRef<MLCEngine | null>(null);
  // Orthogonal to engineState: the engine itself stays 'ready' while a
  // proposal sits awaiting confirmation, since generation has finished --
  // only the UI's next step is gated. See AssistantActionConfirmDialog.tsx.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

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
        let systemPrompt = buildAssistantSystemPrompt(retrieved);
        // Action-mode tool description is appended to the same system
        // prompt, not sent separately -- there's only one system message
        // per request. Adds real tokens (tool schemas + few-shot examples),
        // but the existing token budget below still leaves comfortable room
        // for conversation history in practice (checked against the
        // combined prompt size during implementation, not just assumed).
        if (actionsAllowed) {
          systemPrompt = `${systemPrompt}\n\n${buildActionSystemPrompt()}\n\n${buildActionToolsPrompt()}`;
        }
        const budget = MODEL_CONTEXT_WINDOW_TOKENS - MAX_REPLY_TOKENS;
        const historyBudget = [...messages, userMessage];
        const prunedHistory = pruneHistoryToTokenBudget(historyBudget, budget);

        const engineMessages: AssistantChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...prunedHistory.map((m) => ({ role: m.role, content: m.content })),
        ];

        // Streamed live into the bubble exactly as guide mode always has --
        // including, briefly, a tool call's raw JSON if the model proposes
        // one. Accepted v1 trade-off: the post-processing below replaces
        // that content with a clean summary (or a decline message) the
        // instant generation finishes, so nothing raw ends up in the
        // persisted transcript, but there's a brief flash during streaming
        // on that specific turn. Suppressing it entirely would mean not
        // streaming at all on actions-capable turns, a bigger UX change
        // than this phase's scope.
        const result = await streamAssistantReply(engine, engineMessages, (delta) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMessageId ? { ...m, content: m.content + delta } : m))
          );
        });

        if (actionsAllowed) {
          const { kept, blocked } = applyActionGuard(parseActionToolCall(result.text));
          if (blocked.length) {
            const declineText = `That looks like a ${blocked[0].kind} request, which isn't something I can do yet.`;
            setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: declineText } : m)));
          } else if (kept.length) {
            // v1: first proposed call only -- no chained/multi-action
            // execution without a confirmation in between (see the
            // implementation plan's non-goals).
            const proposal = kept[0];
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? { ...m, content: 'Let me confirm that action — see below.' } : m
              )
            );
            setPendingAction({ kind: proposal.name, args: proposal.args });
          }
        }

        setEngineState('ready');
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Something went wrong generating a response.');
        setEngineState('error');
      }
    },
    [engineState, messages, actionsAllowed]
  );

  const confirmPendingAction = useCallback(
    async (resolvedActivityId?: string) => {
      if (!pendingAction) return;
      if (!dispatchContext) {
        setPendingAction(null);
        return;
      }
      const dispatchArgs: ActionDispatchArgs = { ...pendingAction.args, resolvedActivityId };
      const result = await ACTION_DISPATCH[pendingAction.kind](dispatchArgs, dispatchContext);
      const resultText = result.ok
        ? pendingAction.kind === 'addActivity'
          ? `Added "${String(pendingAction.args.name ?? 'the activity')}" to your itinerary.`
          : `Updated the status to ${String(pendingAction.args.status ?? '')}.`
        : `I couldn't do that: ${result.error ?? 'something went wrong'}.`;
      setMessages((prev) => [...prev, { id: nextId('a'), role: 'assistant', content: resultText }]);
      setPendingAction(null);
    },
    [pendingAction, dispatchContext]
  );

  const cancelPendingAction = useCallback(() => {
    setMessages((prev) => [...prev, { id: nextId('a'), role: 'assistant', content: "Okay, I won't do that." }]);
    setPendingAction(null);
  }, []);

  return {
    engineState,
    loadProgress,
    errorMessage,
    messages,
    capability,
    pendingAction,
    loadModel,
    sendMessage,
    clearConversation,
    confirmPendingAction,
    cancelPendingAction,
  };
};
