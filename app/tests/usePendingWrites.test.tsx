/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';
import { usePendingWrites } from '../hooks/usePendingWrites';

const STORAGE_KEY = 'stp.pending-writes';

const readStorage = (): unknown => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
};

describe('usePendingWrites', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty when no queue is persisted', () => {
    const { result } = renderHook(() => usePendingWrites());
    expect(result.current.pending).toEqual([]);
  });

  it('hydrates the initial queue from localStorage', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'pre-1', kind: 'updateTripCurrency', args: { tripId: 't1', currency: 'EUR' }, enqueuedAtMs: 1, attempts: 0 },
      ]),
    );
    const { result } = renderHook(() => usePendingWrites());
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].kind).toBe('updateTripCurrency');
  });

  it('enqueue assigns an id, stamps the timestamp, and mirrors to localStorage', () => {
    const { result } = renderHook(() => usePendingWrites());
    let id: string = '';
    act(() => {
      id = result.current.enqueue('updateTripCurrency', { tripId: 't1', currency: 'EUR' });
    });
    expect(id).toMatch(/-/);
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].id).toBe(id);
    expect(result.current.pending[0].attempts).toBe(0);
    const stored = readStorage() as Array<{ id: string }>;
    expect(stored[0].id).toBe(id);
  });

  it('remove drops a single entry by id', () => {
    const { result } = renderHook(() => usePendingWrites());
    let id: string = '';
    act(() => {
      id = result.current.enqueue('a', { n: 1 });
      result.current.enqueue('b', { n: 2 });
    });
    act(() => {
      result.current.remove(id);
    });
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].kind).toBe('b');
  });

  it('clear empties the queue', () => {
    const { result } = renderHook(() => usePendingWrites());
    act(() => {
      result.current.enqueue('a', { n: 1 });
      result.current.enqueue('b', { n: 2 });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.pending).toHaveLength(0);
    expect(readStorage()).toEqual([]);
  });

  it('replay calls replayFn per entry and drops successful ones, keeping failures', async () => {
    const { result } = renderHook(() => usePendingWrites());
    act(() => {
      result.current.enqueue('ok', { n: 1 });
      result.current.enqueue('fail', { n: 2 });
      result.current.enqueue('ok', { n: 3 });
    });

    const calls: string[] = [];
    await act(async () => {
      const summary = await result.current.replay(async (entry) => {
        calls.push(entry.kind);
        return entry.kind === 'ok';
      });
      expect(summary.replayed).toBe(2);
      expect(summary.remaining).toBe(1);
    });
    expect(calls).toEqual(['ok', 'fail', 'ok']);
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].kind).toBe('fail');
    expect(result.current.pending[0].attempts).toBe(1);
  });

  it('drops an entry once it reaches maxAttempts so the queue cannot grow unbounded', async () => {
    const { result } = renderHook(() => usePendingWrites({ maxAttempts: 2 }));
    act(() => {
      result.current.enqueue('always-fail', { n: 1 });
    });
    const failReplay = async () => false;
    await act(async () => { await result.current.replay(failReplay); });
    expect(result.current.pending[0].attempts).toBe(1);
    await act(async () => {
      const summary = await result.current.replay(failReplay);
      expect(summary.dropped).toBe(1);
    });
    expect(result.current.pending).toHaveLength(0);
  });

  it('treats replay-fn throws as failures (same as a false resolution)', async () => {
    const { result } = renderHook(() => usePendingWrites());
    act(() => {
      result.current.enqueue('boom', { n: 1 });
    });
    await act(async () => {
      const summary = await result.current.replay(async () => { throw new Error('network'); });
      expect(summary.replayed).toBe(0);
      expect(summary.remaining).toBe(1);
    });
    expect(result.current.pending[0].attempts).toBe(1);
  });

  it('entries enqueued mid-drain survive (the snapshot only drains what existed at replay-start)', async () => {
    const { result } = renderHook(() => usePendingWrites());
    act(() => {
      result.current.enqueue('first', { n: 1 });
    });

    await act(async () => {
      await result.current.replay(async (entry) => {
        if (entry.kind === 'first') {
          // Simulate a mutation enqueuing a follow-up write while we're
          // still draining.
          result.current.enqueue('second', { n: 2 });
        }
        return true;
      });
    });
    // The drain reports `first` as replayed, and `second` sits in the
    // queue for the NEXT drain cycle.
    expect(result.current.pending.map((e) => e.kind)).toEqual(['second']);
  });
});

describe('usePendingWrites: durable, account-scoped queue (offline expenses)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('never drops an entry when maxAttempts is null, even after many failures', async () => {
    const { result } = renderHook(() => usePendingWrites({ maxAttempts: null }));
    act(() => {
      result.current.enqueue('expense', { n: 1 });
    });
    for (let i = 0; i < 12; i += 1) {
      await act(async () => {
        await result.current.replay(async () => ({ outcome: 'retry' as const, error: 'offline' }));
      });
    }
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0].attempts).toBe(12);
    expect(result.current.pending[0].lastError).toBe('offline');
  });

  it('keeps a failed entry for the user, never retries it automatically, and retries on request', async () => {
    const { result } = renderHook(() => usePendingWrites({ maxAttempts: null }));
    let id = '';
    act(() => {
      id = result.current.enqueue('expense', { n: 1 });
    });
    const replayFn = jest.fn(async () => ({ outcome: 'failed' as const, error: 'no access' }));
    await act(async () => {
      const summary = await result.current.replay(replayFn);
      expect(summary.failed).toBe(1);
    });
    expect(result.current.pending[0].status).toBe('failed');
    expect(result.current.pending[0].lastError).toBe('no access');

    await act(async () => {
      await result.current.replay(replayFn);
    });
    expect(replayFn).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.retry(id);
    });
    expect(result.current.pending[0].status).toBe('pending');
    await act(async () => {
      await result.current.replay(replayFn);
    });
    expect(replayFn).toHaveBeenCalledTimes(2);
  });

  it('pauses the whole drain without spending attempts or touching later entries', async () => {
    const { result } = renderHook(() => usePendingWrites({ maxAttempts: null }));
    act(() => {
      result.current.enqueue('a', {});
      result.current.enqueue('b', {});
    });
    const replayFn = jest.fn(async () => ({ outcome: 'pause' as const, error: 'sign in' }));
    await act(async () => {
      const summary = await result.current.replay(replayFn);
      expect(summary.paused).toBe(true);
    });
    expect(replayFn).toHaveBeenCalledTimes(1);
    expect(result.current.pending.map((e) => e.attempts)).toEqual([0, 0]);
  });

  it('skips entries still inside their backoff window unless asked to ignore it', async () => {
    const { result } = renderHook(() => usePendingWrites({ maxAttempts: null, backoffMs: () => 60_000 }));
    act(() => {
      result.current.enqueue('a', {});
    });
    await act(async () => {
      await result.current.replay(async () => ({ outcome: 'retry' as const }));
    });
    const replayFn = jest.fn(async () => true);
    await act(async () => {
      await result.current.replay(replayFn);
    });
    expect(replayFn).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.replay(replayFn, { ignoreBackoff: true });
    });
    expect(replayFn).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toHaveLength(0);
  });

  it('runs only one drain at a time so a resume and a reconnect cannot double-send', async () => {
    const { result } = renderHook(() => usePendingWrites({ maxAttempts: null }));
    act(() => {
      result.current.enqueue('a', {});
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replayFn = jest.fn(async () => {
      await gate;
      return true;
    });
    await act(async () => {
      const first = result.current.replay(replayFn);
      const second = await result.current.replay(replayFn);
      expect(second.replayed).toBe(0);
      release();
      await first;
    });
    expect(replayFn).toHaveBeenCalledTimes(1);
  });

  it('keeps separate queues per storage key and never shows one account the other\'s entries', () => {
    const a = renderHook(() => usePendingWrites({ storageKey: 'stp.q.user-a' }));
    act(() => {
      a.result.current.enqueue('expense', { who: 'a' });
    });
    const b = renderHook(() => usePendingWrites({ storageKey: 'stp.q.user-b' }));
    expect(b.result.current.pending).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem('stp.q.user-a') ?? '[]')).toHaveLength(1);
    expect(window.localStorage.getItem('stp.q.user-b')).toBeNull();
  });

  it('switches to the new account\'s queue when the storage key changes, without carrying entries over', () => {
    window.localStorage.setItem(
      'stp.q.user-b',
      JSON.stringify([{ id: 'b1', kind: 'expense', args: {}, enqueuedAtMs: 1, attempts: 0 }]),
    );
    const { result, rerender } = renderHook(({ k }: { k: string }) => usePendingWrites({ storageKey: k }), {
      initialProps: { k: 'stp.q.user-a' },
    });
    act(() => {
      result.current.enqueue('expense', { who: 'a' });
    });
    rerender({ k: 'stp.q.user-b' });
    expect(result.current.pending.map((e) => e.id)).toEqual(['b1']);
  });

  it('enqueueDurable resolves null (not saved) when storage rejects the write', async () => {
    const { result } = renderHook(() => usePendingWrites());
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    let id: string | null = 'unset';
    await act(async () => {
      id = await result.current.enqueueDurable('expense', { n: 1 });
    });
    setItem.mockRestore();
    expect(id).toBeNull();
    expect(result.current.pending).toHaveLength(0);
  });

  it('enqueueDurable resolves an id only after the entry can be read back', async () => {
    const { result } = renderHook(() => usePendingWrites());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.enqueueDurable('expense', { n: 1 });
    });
    expect(id).toBeTruthy();
    expect(readStorage()).toEqual([expect.objectContaining({ id, kind: 'expense', status: 'pending' })]);
  });
});
