/**
 * @jest-environment jsdom
 */
import {
  clearStoredConversation,
  loadStoredConversation,
  persistConversation,
  type AssistantChatUIMessage,
} from '../utils/assistantChatHistoryStorage';

const MESSAGES: AssistantChatUIMessage[] = [
  { id: 'u-1', role: 'user', content: 'How do I add a flight?' },
  { id: 'a-1', role: 'assistant', content: 'Open the Transfers tab and tap Add.' },
];

describe('assistantChatHistoryStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns an empty array when nothing is stored', () => {
    expect(loadStoredConversation('user-1')).toEqual([]);
  });

  it('round-trips a persisted conversation', () => {
    persistConversation('user-1', MESSAGES);
    expect(loadStoredConversation('user-1')).toEqual(MESSAGES);
  });

  it('scopes storage per user so two accounts on the same browser do not see each other\'s history', () => {
    persistConversation('user-1', MESSAGES);
    expect(loadStoredConversation('user-2')).toEqual([]);
  });

  it('does nothing when userId is missing (never reads/writes without an identity)', () => {
    persistConversation(null, MESSAGES);
    expect(loadStoredConversation(null)).toEqual([]);
    expect(loadStoredConversation(undefined)).toEqual([]);
  });

  it('clears only the given user\'s stored conversation', () => {
    persistConversation('user-1', MESSAGES);
    persistConversation('user-2', MESSAGES);
    clearStoredConversation('user-1');
    expect(loadStoredConversation('user-1')).toEqual([]);
    expect(loadStoredConversation('user-2')).toEqual(MESSAGES);
  });

  it('ignores corrupted JSON and starts fresh rather than throwing', () => {
    window.localStorage.setItem('stp.assistantChatHistory.user-1', '{not valid json');
    expect(loadStoredConversation('user-1')).toEqual([]);
  });

  it('ignores a stored value that is not an array', () => {
    window.localStorage.setItem('stp.assistantChatHistory.user-1', JSON.stringify({ oops: true }));
    expect(loadStoredConversation('user-1')).toEqual([]);
  });

  it('filters out malformed entries within an otherwise-valid array', () => {
    window.localStorage.setItem(
      'stp.assistantChatHistory.user-1',
      JSON.stringify([...MESSAGES, { id: 'bad' }, { role: 'user' }, 'not-an-object'])
    );
    expect(loadStoredConversation('user-1')).toEqual(MESSAGES);
  });

  it('does not throw when localStorage access fails', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('quota exceeded');
    };
    try {
      expect(() => persistConversation('user-1', MESSAGES)).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
