/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';

const appStateListeners: Array<(state: string) => void> = [];
const emitAppState = (state: string) => {
  for (const listener of [...appStateListeners]) listener(state);
};

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  View: 'View',
  Text: 'Text',
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, handler: (state: string) => void) => {
      appStateListeners.push(handler);
      return {
        remove: () => {
          const idx = appStateListeners.indexOf(handler);
          if (idx >= 0) appStateListeners.splice(idx, 1);
        },
      };
    },
  },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
  useWindowDimensions: () => ({ width: 800, height: 600 }),
  useColorScheme: () => 'light',
}));

import { usePolling, type PollResult, type UsePollingOptions } from '../hooks/usePolling';

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
};

const setVisibility = (value: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => value === 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('usePolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setVisibility('visible');
    appStateListeners.length = 0;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('runs poll immediately and reschedules on interval', async () => {
    const poll = jest.fn<Promise<PollResult | void>, []>().mockResolvedValue(undefined);

    renderHook(() =>
      usePolling({
        enabled: true,
        intervalMs: 1000,
        poll,
      } satisfies UsePollingOptions)
    );

    await act(async () => {
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('stops polling when poll returns done: true', async () => {
    const poll = jest
      .fn<Promise<PollResult | void>, []>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ done: true })
      .mockResolvedValue(undefined);

    renderHook(() =>
      usePolling({
        enabled: true,
        intervalMs: 1000,
        poll,
      })
    );

    await act(async () => {
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(10000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('suppresses overlapping polls while one is in flight', async () => {
    let resolveFirst: ((value: PollResult | void) => void) | null = null;
    const poll = jest
      .fn<Promise<PollResult | void>, []>()
      .mockImplementationOnce(
        () =>
          new Promise<PollResult | void>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValue(undefined);

    renderHook(() =>
      usePolling({
        enabled: true,
        intervalMs: 500,
        poll,
      })
    );

    await act(async () => {
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.();
      await flush();
    });

    await act(async () => {
      jest.advanceTimersByTime(500);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('pauses polling when document becomes hidden and resumes when visible', async () => {
    const poll = jest.fn<Promise<PollResult | void>, []>().mockResolvedValue(undefined);

    renderHook(() =>
      usePolling({
        enabled: true,
        intervalMs: 1000,
        poll,
      })
    );

    await act(async () => {
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility('hidden');
      jest.advanceTimersByTime(5000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility('visible');
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('pauses polling when AppState becomes inactive', async () => {
    const poll = jest.fn<Promise<PollResult | void>, []>().mockResolvedValue(undefined);

    renderHook(() =>
      usePolling({
        enabled: true,
        intervalMs: 1000,
        poll,
      })
    );

    await act(async () => {
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitAppState('background');
      jest.advanceTimersByTime(5000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitAppState('active');
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('applies exponential backoff on errors and resets on success', async () => {
    const onError = jest.fn();
    let shouldFail = true;
    const poll = jest.fn<Promise<PollResult | void>, []>().mockImplementation(() => {
      if (shouldFail) return Promise.reject(new Error('network'));
      return Promise.resolve();
    });

    renderHook(() =>
      usePolling({
        enabled: true,
        intervalMs: 1000,
        backoffFactor: 2,
        maxIntervalMs: 8000,
        poll,
        onError,
      })
    );

    await act(async () => {
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(4000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(3);

    shouldFail = false;
    await act(async () => {
      jest.advanceTimersByTime(8000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(4);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(5);
  });

  it('does nothing when disabled and resumes when enabled flips true', async () => {
    const poll = jest.fn<Promise<PollResult | void>, []>().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePolling({
          enabled,
          intervalMs: 1000,
          poll,
        }),
      { initialProps: { enabled: false } }
    );

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(0);

    rerender({ enabled: true });
    await act(async () => {
      await flush();
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
