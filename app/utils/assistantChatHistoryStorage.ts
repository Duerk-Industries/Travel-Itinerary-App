/**
 * Client-side-only persistence for the guide assistant's conversation.
 *
 * Deliberately localStorage, not a server table: the whole feature is sold
 * on "nothing you ask ever leaves your device" (see
 * docs/implementation_plans/implementation-plan-ai-assistant.md, §8 and
 * Phase 1 findings). Storing the conversation server-side would quietly
 * break that promise. Scoped per userId (same trust boundary as the auth
 * token already sitting in localStorage) so two accounts sharing a browser
 * don't see each other's questions.
 */

export type AssistantChatUIMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

const storageKeyForUser = (userId: string): string => `stp.assistantChatHistory.${userId}`;

type LocalStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const getLocalStorage = (): LocalStorageLike | null => {
  const candidate = (globalThis as any)?.localStorage;
  if (
    candidate &&
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function' &&
    typeof candidate.removeItem === 'function'
  ) {
    return candidate;
  }
  return null;
};

const isValidMessage = (value: unknown): value is AssistantChatUIMessage => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string'
  );
};

export const loadStoredConversation = (userId: string | null | undefined): AssistantChatUIMessage[] => {
  if (!userId) return [];
  try {
    const storage = getLocalStorage();
    if (!storage) return [];
    const raw = storage.getItem(storageKeyForUser(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidMessage);
  } catch {
    // Corrupted JSON, storage disabled, etc. -- start fresh rather than throw.
    return [];
  }
};

export const persistConversation = (
  userId: string | null | undefined,
  messages: AssistantChatUIMessage[]
): void => {
  if (!userId) return;
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.setItem(storageKeyForUser(userId), JSON.stringify(messages));
  } catch {
    // Ignore storage failures (quota exceeded, private browsing, etc.) --
    // losing persistence isn't worth surfacing as a user-facing error for
    // a guide chat.
  }
};

export const clearStoredConversation = (userId: string | null | undefined): void => {
  if (!userId) return;
  try {
    const storage = getLocalStorage();
    if (storage) storage.removeItem(storageKeyForUser(userId));
  } catch {
    // Ignore.
  }
};
