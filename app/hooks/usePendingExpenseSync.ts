import { AppState } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePendingWrites, type PendingWrite } from './usePendingWrites';
import {
  PENDING_EXPENSE_KIND,
  backoffDelayMs,
  pendingExpensesStorageKey,
  sendPendingExpense,
  type PendingExpenseArgs,
} from '../utils/pendingExpenses';

export type PendingExpenseEntry = PendingWrite<PendingExpenseArgs>;

type Options = {
  userId: string | null | undefined;
  backendUrl: string;
  headers: Record<string, string>;
  /** True only when the device is online AND the session can authenticate requests. */
  canSync: boolean;
  /** Called once per expense the server confirms, so the caller can show it in its list. */
  onSynced: (expense: Record<string, unknown>, tripId: string) => void;
};

const RETRY_TICK_MS = 30_000;
const NOTICE_MS = 6_000;

/**
 * Offline-created expenses: an account-scoped, durable queue plus an app-wide drain. Lives at the app
 * root (not inside the Expenses tab) so queued expenses sync after reconnect even if the user has
 * navigated elsewhere. Entries are never dropped automatically: a failure either retries with backoff
 * or lands in a "couldn't sync" state the user resolves.
 */
export function usePendingExpenseSync({ userId, backendUrl, headers, canSync, onSynced }: Options) {
  const storageKey = useMemo(
    () => pendingExpensesStorageKey(userId || 'anonymous', backendUrl),
    [userId, backendUrl],
  );
  const queue = usePendingWrites({ storageKey, maxAttempts: null, backoffMs: backoffDelayMs });
  const { replay, enqueueDurable, retry } = queue;

  const headersRef = useRef(headers);
  headersRef.current = headers;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const pausedForAuthRef = useRef<string | null>(null);
  const [tick, setTick] = useState(0);
  const [syncedNotice, setSyncedNotice] = useState<string | null>(null);

  const entries = useMemo(
    () => (userId ? (queue.pending.filter((e) => e.kind === PENDING_EXPENSE_KIND) as PendingExpenseEntry[]) : []),
    [queue.pending, userId],
  );
  const hasDue = entries.some((e) => e.status !== 'failed');

  useEffect(() => {
    if (!hasDue) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), RETRY_TICK_MS);
    return () => clearInterval(id);
  }, [hasDue]);

  const authValue = headers.Authorization ?? '';
  const scope = JSON.stringify([userId, backendUrl, authValue, canSync]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') setTick(n => n + 1); });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!canSync || !userId || !hasDue) return;
    // A 401 paused the queue for this exact credential; wait for a new sign-in instead of looping.
    if (pausedForAuthRef.current !== null && pausedForAuthRef.current === authValue) return;
    pausedForAuthRef.current = null;
    const replayScope = scopeRef.current;
    const current = () => mounted.current && scopeRef.current === replayScope;
    const replayHeaders = { ...headersRef.current };
    void (async () => {
      const summary = await replay(async (entry) => {
        if (!current()) return { outcome: 'pause' as const };
        const args = entry.args as PendingExpenseArgs;
        const result = await sendPendingExpense(args, { backendUrl, headers: replayHeaders });
        if (current() && result.outcome === 'done') onSyncedRef.current(result.expense, args.payload.tripId);
        return result;
      });
      if (!current()) return;
      if (summary.paused) pausedForAuthRef.current = authValue;
      if (summary.replayed > 0) {
        setSyncedNotice(`${summary.replayed} offline expense${summary.replayed === 1 ? '' : 's'} synced`);
      }
    })();
    // Queue commits can change entries while this drain owns its lease. Only
    // identity/connectivity changes fence callbacks, not its own progress updates.
    // `entries.length` and `tick` re-run the drain for newly queued entries and expired backoff.
  }, [authValue, backendUrl, canSync, entries.length, hasDue, replay, tick, userId]);

  useEffect(() => {
    if (!syncedNotice) return undefined;
    const id = setTimeout(() => setSyncedNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [syncedNotice]);

  /** Resolves to the Idempotency-Key args once the expense is safely stored on this device; `null` if storage failed. */
  const queueExpense = useCallback(
    async (args: PendingExpenseArgs): Promise<string | null> => {
      if (!userId) return null;
      return enqueueDurable(PENDING_EXPENSE_KIND, args);
    },
    [enqueueDurable, userId],
  );

  const retryEntry = useCallback((id: string) => {
    pausedForAuthRef.current = null;
    retry(id);
  }, [retry]);

  return {
    entries,
    storageError: userId ? queue.storageError : null,
    getRecoveryData: queue.getRecoveryData,
    syncedNotice,
    queueExpense,
    retryEntry,
    replaceEntry: queue.replaceFailedDurable,
    discardEntry: queue.removeDurable,
    discardAll: queue.clearDurable,
    syncNow: () => setTick(n => n + 1),
  };
}
