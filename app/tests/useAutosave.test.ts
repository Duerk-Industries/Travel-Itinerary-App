/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';
import { useAutosave } from '../utils/useAutosave';

describe('useAutosave', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces: only the last schedule() call within the delay window actually runs', async () => {
    const { result } = renderHook(() => useAutosave(1500));
    const run = jest.fn(async () => {});

    act(() => { result.current.schedule('field-1', run); });
    act(() => { jest.advanceTimersByTime(1000); }); // before the delay elapses
    act(() => { result.current.schedule('field-1', run); }); // resets the timer
    act(() => { jest.advanceTimersByTime(1000); }); // still before 1500ms from the reset
    expect(run).not.toHaveBeenCalled();

    await act(async () => { jest.advanceTimersByTime(600); await Promise.resolve(); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports pending → saving → saved through states', async () => {
    const { result } = renderHook(() => useAutosave(1500));
    let resolveRun: () => void = () => {};
    const run = jest.fn(() => new Promise<void>((resolve) => { resolveRun = resolve; }));

    act(() => { result.current.schedule('field-1', run); });
    expect(result.current.states['field-1'].status).toBe('pending');

    await act(async () => { jest.advanceTimersByTime(1500); await Promise.resolve(); });
    expect(result.current.states['field-1'].status).toBe('saving');

    await act(async () => { resolveRun(); await Promise.resolve(); });
    expect(result.current.states['field-1'].status).toBe('saved');
    expect(result.current.states['field-1'].savedAt).not.toBeNull();
  });

  it('sets status to error and surfaces the message when run() rejects', async () => {
    const { result } = renderHook(() => useAutosave(1500));
    const run = jest.fn(async () => { throw new Error('Someone else edited this'); });

    act(() => { result.current.schedule('field-1', run); });
    await act(async () => { jest.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.states['field-1'].status).toBe('error');
    expect(result.current.states['field-1'].error).toBe('Someone else edited this');
  });

  it('flush() bypasses the debounce timer and saves immediately', async () => {
    const { result } = renderHook(() => useAutosave(1500));
    const run = jest.fn(async () => {});

    act(() => { result.current.schedule('field-1', run); });
    await act(async () => { await result.current.flush('field-1'); });

    expect(run).toHaveBeenCalledTimes(1);
    // The debounce timer must not fire a second time later.
    act(() => { jest.advanceTimersByTime(2000); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('flush() on a key with nothing pending is a no-op, not an error', async () => {
    const { result } = renderHook(() => useAutosave(1500));
    await expect(act(async () => { await result.current.flush('never-scheduled'); })).resolves.not.toThrow();
  });

  it('cancel() clears the pending timer and resets status to idle', async () => {
    const { result } = renderHook(() => useAutosave(1500));
    const run = jest.fn(async () => {});

    act(() => { result.current.schedule('field-1', run); });
    act(() => { result.current.cancel('field-1'); });
    act(() => { jest.advanceTimersByTime(2000); });

    expect(run).not.toHaveBeenCalled();
    expect(result.current.states['field-1'].status).toBe('idle');
  });

  it('flushAll() flushes every distinct pending key independently', async () => {
    const { result } = renderHook(() => useAutosave(1500));
    const runA = jest.fn(async () => {});
    const runB = jest.fn(async () => {});

    act(() => {
      result.current.schedule('field-a', runA);
      result.current.schedule('field-b', runB);
    });
    await act(async () => { await result.current.flushAll(); });

    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it('flushAll() does not throw even when one key rejects', async () => {
    const { result } = renderHook(() => useAutosave(1500));
    const runOk = jest.fn(async () => {});
    const runFails = jest.fn(async () => { throw new Error('conflict'); });

    act(() => {
      result.current.schedule('field-a', runOk);
      result.current.schedule('field-b', runFails);
    });
    await expect(act(async () => { await result.current.flushAll(); })).resolves.not.toThrow();
    expect(runOk).toHaveBeenCalledTimes(1);
    expect(runFails).toHaveBeenCalledTimes(1);
  });
});
