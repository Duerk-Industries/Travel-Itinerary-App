/**
 * @jest-environment jsdom
 */

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
