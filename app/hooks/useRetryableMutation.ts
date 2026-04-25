import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Idle before any attempt; pending while an attempt is in flight; success or
 * failed once settled. Mutually exclusive — the hook never reports two at once.
 */
export type RetryableMutationState = 'idle' | 'pending' | 'success' | 'failed';

export interface UseRetryableMutationResult<TArgs, TResult> {
  /** Current lifecycle phase. */
  state: RetryableMutationState;
  /** Last captured error, or null if the last attempt succeeded or none has run. */
  error: Error | null;
  /** Last successful result, or null if no attempt has ever succeeded. */
  data: TResult | null;
  /** Kick off a new attempt with fresh args. Replaces the "last args" stash for retry. */
  run: (args: TArgs) => Promise<TResult | null>;
  /** Re-execute with the most recent args. No-op if nothing has been run yet or a run is in flight. */
  retry: () => Promise<TResult | null>;
  /** Return to `idle` and clear `error` + `data` + the stored retry args. */
  reset: () => void;
}

/**
 * Thin lifecycle wrapper for a one-shot mutation. Exposes a 4-state machine
 * (`idle → pending → success|failed`) plus a `retry()` that replays the most
 * recent args so UI can render a dedicated retry affordance after a failure.
 *
 * Designed for **idempotent writes** only — each retry re-runs the exact same
 * `mutate(args)` call. For non-idempotent operations (e.g. `POST /api/expenses`
 * without a client idempotency key) the server must dedupe, otherwise a retry
 * after an ambiguous network failure can double-write. See Priority 13's
 * idempotency work for the server-side story.
 *
 * Behaviors:
 * - `run()` is ignored if a previous attempt is still pending (single-flight).
 * - `retry()` is a no-op if nothing has been run yet or if already pending.
 * - State is never mutated after unmount (guarded by a mounted ref).
 * - Throwing inside `mutate` is caught and surfaced as `error` + `state='failed'` —
 *   the returned promise resolves to `null` so callers can branch without try/catch.
 */
export function useRetryableMutation<TArgs, TResult>(
  mutate: (args: TArgs) => Promise<TResult>,
): UseRetryableMutationResult<TArgs, TResult> {
  const [state, setState] = useState<RetryableMutationState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TResult | null>(null);
  const mutateRef = useRef(mutate);
  const lastArgsRef = useRef<{ value: TArgs } | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mutateRef.current = mutate;
  }, [mutate]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(async (args: TArgs): Promise<TResult | null> => {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setState('pending');
    setError(null);
    try {
      const result = await mutateRef.current(args);
      if (!mountedRef.current) return result;
      setData(result);
      setState('success');
      return result;
    } catch (err) {
      if (!mountedRef.current) return null;
      const normalized = err instanceof Error ? err : new Error(String(err));
      setError(normalized);
      setState('failed');
      return null;
    } finally {
      pendingRef.current = false;
    }
  }, []);

  const run = useCallback(
    async (args: TArgs): Promise<TResult | null> => {
      lastArgsRef.current = { value: args };
      return execute(args);
    },
    [execute],
  );

  const retry = useCallback(async (): Promise<TResult | null> => {
    const stored = lastArgsRef.current;
    if (!stored) return null;
    return execute(stored.value);
  }, [execute]);

  const reset = useCallback(() => {
    if (pendingRef.current) return;
    lastArgsRef.current = null;
    setState('idle');
    setError(null);
    setData(null);
  }, []);

  return { state, error, data, run, retry, reset };
}
