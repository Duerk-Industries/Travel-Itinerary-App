/**
 * @jest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRetryableMutation } from '../hooks/useRetryableMutation';

describe('useRetryableMutation', () => {
  it('starts in idle state with no data or error', () => {
    const mutate = jest.fn();
    const { result } = renderHook(() => useRetryableMutation(mutate));
    expect(result.current.state).toBe('idle');
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('transitions idle → pending → success on a successful run', async () => {
    let resolve!: (v: string) => void;
    const mutate = jest.fn(
      () => new Promise<string>((r) => { resolve = r; }),
    );
    const { result } = renderHook(() => useRetryableMutation(mutate));

    let runPromise: Promise<string | null>;
    act(() => {
      runPromise = result.current.run({ id: 1 } as any);
    });
    await waitFor(() => expect(result.current.state).toBe('pending'));

    await act(async () => {
      resolve('ok');
      await runPromise;
    });
    expect(result.current.state).toBe('success');
    expect(result.current.data).toBe('ok');
    expect(result.current.error).toBeNull();
    expect(mutate).toHaveBeenCalledWith({ id: 1 });
  });

  it('transitions idle → pending → failed on a thrown error', async () => {
    const mutate = jest.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useRetryableMutation(mutate));

    await act(async () => {
      await result.current.run({ id: 1 } as any);
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.error?.message).toBe('network down');
    expect(result.current.data).toBeNull();
  });

  it('retry() replays the last args and can succeed after a failure', async () => {
    const mutate = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    const { result } = renderHook(() => useRetryableMutation(mutate));

    await act(async () => {
      await result.current.run({ id: 42 } as any);
    });
    expect(result.current.state).toBe('failed');

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state).toBe('success');
    expect(result.current.data).toBe('recovered');
    expect(result.current.error).toBeNull();
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenNthCalledWith(1, { id: 42 });
    expect(mutate).toHaveBeenNthCalledWith(2, { id: 42 });
  });

  it('retry() is a no-op when nothing has been run yet', async () => {
    const mutate = jest.fn();
    const { result } = renderHook(() => useRetryableMutation(mutate));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.retry();
    });
    expect(returned).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
  });

  it('ignores concurrent run() calls while a previous one is still pending', async () => {
    let resolve!: (v: string) => void;
    const mutate = jest.fn(
      () => new Promise<string>((r) => { resolve = r; }),
    );
    const { result } = renderHook(() => useRetryableMutation(mutate));

    let firstRun!: Promise<string | null>;
    let secondReturned: unknown;
    act(() => {
      firstRun = result.current.run('A' as any);
    });
    await waitFor(() => expect(result.current.state).toBe('pending'));

    await act(async () => {
      secondReturned = await result.current.run('B' as any);
    });
    expect(secondReturned).toBeNull();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith('A');

    await act(async () => {
      resolve('done');
      await firstRun;
    });
    expect(result.current.state).toBe('success');
    expect(result.current.data).toBe('done');
  });

  it('reset() returns to idle and clears error/data/last args', async () => {
    const mutate = jest
      .fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce('late-success');
    const { result } = renderHook(() => useRetryableMutation(mutate));

    await act(async () => {
      await result.current.run({ v: 1 } as any);
    });
    expect(result.current.state).toBe('failed');

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();

    // retry() after reset should be a no-op because the stash is cleared.
    await act(async () => {
      const out = await result.current.retry();
      expect(out).toBeNull();
    });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('does not setState after unmount (no "update on unmounted" warnings)', async () => {
    let resolve!: (v: string) => void;
    const mutate = jest.fn(
      () => new Promise<string>((r) => { resolve = r; }),
    );
    const { result, unmount } = renderHook(() => useRetryableMutation(mutate));

    const warnSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let runPromise!: Promise<string | null>;
    act(() => {
      runPromise = result.current.run('x' as any);
    });
    await waitFor(() => expect(result.current.state).toBe('pending'));
    unmount();
    resolve('late');
    await runPromise;
    const warnings = warnSpy.mock.calls.map((c) => c.join(' '));
    expect(warnings.filter((w) => /unmounted component|Can't perform a React state update/.test(w))).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('latest success overwrites any previous error', async () => {
    const mutate = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useRetryableMutation(mutate));

    await act(async () => {
      await result.current.run({ n: 1 } as any);
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.run({ n: 2 } as any);
    });
    expect(result.current.state).toBe('success');
    expect(result.current.data).toBe('ok');
    expect(result.current.error).toBeNull();
  });
});
