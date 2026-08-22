/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import { renderHook, act } from '@testing-library/react-native';
import { useAssistantChat, MAX_CONVERSATION_MESSAGES } from '../hooks/useAssistantChat';

// Never run real on-device inference in tests -- mock the WebLLM wrapper
// entirely, same rationale as the implementation plan's test-coverage
// section (too slow/heavy and not deterministic).
jest.mock('../utils/assistantLocalModel', () => {
  const actual = jest.requireActual('../utils/assistantLocalModel');
  return {
    ...actual,
    detectAssistantModelCapability: jest.fn(() => ({ supported: true })),
    loadAssistantEngine: jest.fn(),
    streamAssistantReply: jest.fn(),
  };
});

import { detectAssistantModelCapability, loadAssistantEngine, streamAssistantReply } from '../utils/assistantLocalModel';

const mockedLoadAssistantEngine = loadAssistantEngine as jest.Mock;
const mockedStreamAssistantReply = streamAssistantReply as jest.Mock;
const mockedDetectCapability = detectAssistantModelCapability as jest.Mock;

describe('useAssistantChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockedDetectCapability.mockReturnValue({ supported: true });
    mockedLoadAssistantEngine.mockResolvedValue({ __fakeEngine: true });
  });

  it('starts idle and reflects an unsupported device without attempting to load', async () => {
    mockedDetectCapability.mockReturnValue({ supported: false, reason: 'no-webgpu' });
    const { result } = renderHook(() => useAssistantChat());
    expect(result.current.engineState).toBe('idle');
    expect(result.current.capability).toEqual({ supported: false, reason: 'no-webgpu' });

    await act(async () => {
      await result.current.loadModel();
    });
    expect(result.current.engineState).toBe('idle');
    expect(mockedLoadAssistantEngine).not.toHaveBeenCalled();
  });

  it('transitions idle -> loading -> ready on successful load', async () => {
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.loadModel();
    });

    expect(mockedLoadAssistantEngine).toHaveBeenCalledTimes(1);
    expect(result.current.engineState).toBe('ready');
    expect(result.current.errorMessage).toBeNull();
  });

  it('transitions to an error state when loading fails', async () => {
    mockedLoadAssistantEngine.mockRejectedValue(new Error('WebGPU device lost'));
    const { result } = renderHook(() => useAssistantChat());

    await act(async () => {
      await result.current.loadModel();
    });

    expect(result.current.engineState).toBe('error');
    expect(result.current.errorMessage).toBe('WebGPU device lost');
  });

  it('streams an assistant reply, appending deltas to the assistant message as they arrive', async () => {
    mockedStreamAssistantReply.mockImplementation(async (_engine: unknown, _messages: unknown, onDelta: (d: string) => void) => {
      onDelta('Hello');
      onDelta(' there');
      return { text: 'Hello there', usage: null };
    });

    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.loadModel();
    });

    await act(async () => {
      await result.current.sendMessage('How do I add a flight?');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'How do I add a flight?' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello there' });
    expect(result.current.engineState).toBe('ready');
  });

  it('passes a system prompt and pruned history through to streamAssistantReply', async () => {
    mockedStreamAssistantReply.mockResolvedValue({ text: 'ok', usage: null });
    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.loadModel();
    });
    await act(async () => {
      await result.current.sendMessage('How do I add a flight?');
    });

    const [, engineMessages] = mockedStreamAssistantReply.mock.calls[0];
    expect(engineMessages[0].role).toBe('system');
    expect(engineMessages[engineMessages.length - 1]).toMatchObject({ role: 'user', content: 'How do I add a flight?' });
  });

  it('ignores sendMessage when no engine has been loaded yet', async () => {
    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.sendMessage('hello');
    });
    expect(result.current.messages).toHaveLength(0);
    expect(mockedStreamAssistantReply).not.toHaveBeenCalled();
  });

  it('ignores an empty/whitespace-only message', async () => {
    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.loadModel();
    });
    await act(async () => {
      await result.current.sendMessage('   ');
    });
    expect(result.current.messages).toHaveLength(0);
  });

  it('sets an error state and stops accepting new messages once the conversation length cap is reached', async () => {
    mockedStreamAssistantReply.mockResolvedValue({ text: 'ok', usage: null });
    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.loadModel();
    });

    for (let i = 0; i < MAX_CONVERSATION_MESSAGES / 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await result.current.sendMessage(`message ${i}`);
      });
    }
    expect(result.current.messages).toHaveLength(MAX_CONVERSATION_MESSAGES);

    await act(async () => {
      await result.current.sendMessage('one too many');
    });
    expect(result.current.messages).toHaveLength(MAX_CONVERSATION_MESSAGES);
    expect(result.current.errorMessage).toMatch(/length limit/i);
  });

  it('surfaces a generation error without losing the conversation so far', async () => {
    mockedStreamAssistantReply.mockRejectedValueOnce(new Error('generation aborted'));
    const { result } = renderHook(() => useAssistantChat());
    await act(async () => {
      await result.current.loadModel();
    });
    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(result.current.engineState).toBe('error');
    expect(result.current.errorMessage).toBe('generation aborted');
    expect(result.current.messages).toHaveLength(2);
  });

  describe('client-side conversation persistence (Phase 2)', () => {
    it('restores a previously-persisted conversation for the same user on mount', () => {
      window.localStorage.setItem(
        'stp.assistantChatHistory.user-1',
        JSON.stringify([{ id: 'u-1', role: 'user', content: 'How do I add a flight?' }])
      );
      const { result } = renderHook(() => useAssistantChat('user-1'));
      expect(result.current.messages).toEqual([
        { id: 'u-1', role: 'user', content: 'How do I add a flight?' },
      ]);
    });

    it('does not restore another user\'s conversation', () => {
      window.localStorage.setItem(
        'stp.assistantChatHistory.user-1',
        JSON.stringify([{ id: 'u-1', role: 'user', content: 'private question' }])
      );
      const { result } = renderHook(() => useAssistantChat('user-2'));
      expect(result.current.messages).toEqual([]);
    });

    it('persists the conversation once a reply finishes, scoped to the given userId', async () => {
      mockedStreamAssistantReply.mockImplementation(async (_engine: unknown, _messages: unknown, onDelta: (d: string) => void) => {
        onDelta('answer');
        return { text: 'answer', usage: null };
      });
      const { result } = renderHook(() => useAssistantChat('user-1'));
      await act(async () => {
        await result.current.loadModel();
      });
      await act(async () => {
        await result.current.sendMessage('How do I add a flight?');
      });

      const stored = JSON.parse(window.localStorage.getItem('stp.assistantChatHistory.user-1') ?? '[]');
      expect(stored).toEqual(result.current.messages);
      expect(window.localStorage.getItem('stp.assistantChatHistory.user-2')).toBeNull();
    });

    it('does not write to storage while a reply is still streaming', async () => {
      let resolveStream: (() => void) | null = null;
      mockedStreamAssistantReply.mockImplementation(
        (_engine: unknown, _messages: unknown, onDelta: (d: string) => void) =>
          new Promise((resolve) => {
            onDelta('partial');
            resolveStream = () => resolve({ text: 'partial answer', usage: null });
          })
      );
      const { result } = renderHook(() => useAssistantChat('user-1'));
      await act(async () => {
        await result.current.loadModel();
      });

      const readStored = () => JSON.parse(window.localStorage.getItem('stp.assistantChatHistory.user-1') ?? '[]');

      let sendPromise!: Promise<void>;
      act(() => {
        sendPromise = result.current.sendMessage('How do I add a flight?');
      });
      // Mid-stream: whatever's in storage (at most the empty array written on
      // mount) must not yet contain this turn -- the write happens once the
      // reply settles, not on every streamed token.
      expect(readStored().some((m: any) => m.content === 'How do I add a flight?')).toBe(false);

      await act(async () => {
        resolveStream?.();
        await sendPromise;
      });
      expect(readStored().some((m: any) => m.content === 'How do I add a flight?')).toBe(true);
    });

    it('clearConversation empties both the in-memory messages and stored history', async () => {
      mockedStreamAssistantReply.mockResolvedValue({ text: 'answer', usage: null });
      const { result } = renderHook(() => useAssistantChat('user-1'));
      await act(async () => {
        await result.current.loadModel();
      });
      await act(async () => {
        await result.current.sendMessage('hello');
      });
      expect(result.current.messages.length).toBeGreaterThan(0);

      act(() => {
        result.current.clearConversation();
      });

      expect(result.current.messages).toEqual([]);
      // "Cleared" means storage no longer reflects a conversation -- either
      // the key is removed outright, or (since the persist-on-settle effect
      // reactively re-runs right after messages becomes []) it holds an
      // empty array. Both are functionally "no history" once read back
      // through loadStoredConversation; what matters is nothing survives.
      const stored = window.localStorage.getItem('stp.assistantChatHistory.user-1');
      expect(JSON.parse(stored ?? '[]')).toEqual([]);
    });

    it('does not persist or restore anything when no userId is provided', async () => {
      mockedStreamAssistantReply.mockResolvedValue({ text: 'answer', usage: null });
      const { result } = renderHook(() => useAssistantChat());
      await act(async () => {
        await result.current.loadModel();
      });
      await act(async () => {
        await result.current.sendMessage('hello');
      });
      expect(window.localStorage.length).toBe(0);
    });

    it('does not wipe a stored conversation when userId is null at mount and only arrives on a later render', () => {
      // Reproduces a real bug found via manual testing: this app's session
      // restore decodes/sets userId asynchronously, so a hook consumer can
      // genuinely mount with userId still null for a render or two. The
      // hook must not treat "haven't loaded yet" the same as "conversation
      // is empty" once userId does arrive -- doing so silently overwrote a
      // real stored conversation with [].
      window.localStorage.setItem(
        'stp.assistantChatHistory.user-1',
        JSON.stringify([{ id: 'u-1', role: 'user', content: 'earlier question' }])
      );

      const { result, rerender } = renderHook(({ userId }) => useAssistantChat(userId), {
        initialProps: { userId: null as string | null },
      });
      expect(result.current.messages).toEqual([]);

      rerender({ userId: 'user-1' });

      expect(result.current.messages).toEqual([
        { id: 'u-1', role: 'user', content: 'earlier question' },
      ]);
      // The critical assertion: storage must still hold what was there
      // before userId arrived -- not have been clobbered by a persist
      // effect firing with the stale empty `messages`.
      expect(JSON.parse(window.localStorage.getItem('stp.assistantChatHistory.user-1')!)).toEqual([
        { id: 'u-1', role: 'user', content: 'earlier question' },
      ]);
    });
  });
});
