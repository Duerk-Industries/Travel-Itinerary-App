import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension' | string;

export type PollResult = { done?: boolean };

export type UsePollingOptions = {
  enabled: boolean;
  intervalMs: number;
  poll: () => Promise<PollResult | void> | PollResult | void;
  pauseWhenHidden?: boolean;
  immediate?: boolean;
  maxIntervalMs?: number;
  backoffFactor?: number;
  onError?: (error: unknown) => void;
};

const isDocumentHidden = (): boolean => {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden';
};

export function usePolling({
  enabled,
  intervalMs,
  poll,
  pauseWhenHidden = true,
  immediate = true,
  maxIntervalMs,
  backoffFactor = 2,
  onError,
}: UsePollingOptions): void {
  const pollRef = useRef(poll);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!enabled || !Number.isFinite(intervalMs) || intervalMs <= 0) return;

    const cap = Math.max(
      intervalMs,
      Number.isFinite(maxIntervalMs ?? NaN) && (maxIntervalMs as number) > 0
        ? (maxIntervalMs as number)
        : intervalMs * 8
    );
    const factor = backoffFactor > 1 ? backoffFactor : 1;

    let cancelled = false;
    let inFlight = false;
    let stopped = false;
    let currentInterval = intervalMs;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let paused = pauseWhenHidden && isDocumentHidden();

    const clearTimer = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const runPoll = async () => {
      if (cancelled || stopped || paused || inFlight) return;
      inFlight = true;
      try {
        const result = await pollRef.current();
        if (cancelled) return;
        currentInterval = intervalMs;
        if (result && typeof result === 'object' && result.done === true) {
          stopped = true;
          return;
        }
      } catch (err) {
        if (cancelled) return;
        currentInterval = Math.min(cap, Math.max(intervalMs, currentInterval * factor));
        onErrorRef.current?.(err);
      } finally {
        inFlight = false;
      }
      if (!cancelled && !stopped && !paused) {
        scheduleNext(currentInterval);
      }
    };

    const scheduleNext = (delay: number) => {
      clearTimer();
      if (cancelled || stopped || paused) return;
      timerId = setTimeout(() => {
        timerId = null;
        void runPoll();
      }, delay);
    };

    const handleVisibilityChange = () => {
      if (cancelled || stopped) return;
      const nowHidden = isDocumentHidden();
      if (nowHidden) {
        if (!paused) {
          paused = true;
          clearTimer();
        }
        return;
      }
      if (paused) {
        paused = false;
        if (!inFlight) void runPoll();
      }
    };

    const handleAppStateChange = (next: AppStateStatus) => {
      if (cancelled || stopped) return;
      if (next === 'active') {
        if (paused) {
          paused = false;
          if (!inFlight) void runPoll();
        }
        return;
      }
      if (!paused) {
        paused = true;
        clearTimer();
      }
    };

    let removeVisibilityListener: (() => void) | null = null;
    let appStateSubscription: { remove: () => void } | null = null;

    if (pauseWhenHidden) {
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', handleVisibilityChange);
        removeVisibilityListener = () =>
          document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (AppState && typeof AppState.addEventListener === 'function') {
        appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
      }
    }

    if (!paused) {
      if (immediate) {
        void runPoll();
      } else {
        scheduleNext(currentInterval);
      }
    }

    return () => {
      cancelled = true;
      clearTimer();
      removeVisibilityListener?.();
      appStateSubscription?.remove();
    };
  }, [enabled, intervalMs, pauseWhenHidden, immediate, maxIntervalMs, backoffFactor]);
}
