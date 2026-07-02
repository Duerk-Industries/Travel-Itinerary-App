import { useCallback, useEffect, useRef, useState } from 'react';
import { canAccessWebStorage, readAsync, readSync, writeAsync, writeSync } from '../utils/persistentStorage';

/**
 * A single queued write captured while the client was offline. The `kind`
 * identifies which mutation to replay (e.g. `updateTripCurrency`) so a
 * single queue can serve many call sites; `args` is the caller-opaque
 * payload passed back to `replayFn(kind, args)` during drain.
 */
export interface PendingWrite<TArgs = unknown> {
  /** Stable client id for dedupe + retry cap; assigned on enqueue. */
  id: string;
  /** Opaque mutation discriminator the replay dispatcher switches on. */
  kind: string;
  /** Caller-owned payload. Must be JSON-serializable. */
  args: TArgs;
  /** Wall-clock ms when enqueued. Surfaced in UI so stale entries are obvious. */
  enqueuedAtMs: number;
  /** How many times we've attempted to replay. Caps to `maxAttempts`. */
  attempts: number;
}

const STORAGE_KEY = 'stp.pending-writes';
const DEFAULT_MAX_ATTEMPTS = 5;

const parseQueue = (raw: string | null): PendingWrite[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingWrite[]) : [];
  } catch {
    return [];
  }
};

const readQueueSync = (): PendingWrite[] => parseQueue(readSync(STORAGE_KEY));

const persistQueue = (queue: PendingWrite[]): void => {
  const serialized = JSON.stringify(queue);
  if (canAccessWebStorage()) {
    writeSync(STORAGE_KEY, serialized);
  } else {
    void writeAsync(STORAGE_KEY, serialized);
  }
};

const makeId = (): string => {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rnd}`;
};

/**
 * `replayFn` contract: resolve true when the write was successfully
 * applied (the entry is dropped from the queue), resolve false or throw to
 * leave it in place for the next replay. The hook bumps `attempts` on
 * failure; when `attempts >= maxAttempts` the entry is dropped so the
 * queue can't grow without bound from a permanent backend failure.
 */
export type PendingWriteReplayFn = (entry: PendingWrite) => Promise<boolean>;

export interface UsePendingWritesOptions {
  /** Maximum replay attempts before an entry is dropped. Default 5. */
  maxAttempts?: number;
}

export interface UsePendingWritesResult {
  /** Current queue snapshot, ordered oldest-first. */
  pending: PendingWrite[];
  /** Queue a new write and return its generated id. */
  enqueue: <TArgs>(kind: string, args: TArgs) => string;
  /** Remove a single entry by id (no-op if not found). */
  remove: (id: string) => void;
  /** Clear the full queue. Used by "give up" UI affordances. */
  clear: () => void;
  /** Iterate the queue, calling `replayFn` per entry. Removes ones that succeed. */
  replay: (replayFn: PendingWriteReplayFn) => Promise<{ replayed: number; remaining: number; dropped: number }>;
}

/**
 * Hook that persists pending writes via the hybrid persistentStorage helper
 * (localStorage on web, AsyncStorage on native) and exposes a replay API.
 * Pairs with `useRetryableMutation` + `useConnectionState`:
 *
 *   - Call site that just failed with `!navigator.onLine` → `enqueue(kind, args)`.
 *   - Root effect watches `useConnectionState().status === 'online'` →
 *     `replay((entry) => dispatch(entry.kind, entry.args))`.
 *
 * The hook itself does NOT listen for connection changes — that's left to
 * the caller so the dispatcher can live alongside all the mutation hooks
 * that compose it. This keeps the hook shape tiny and lets the caller
 * decide when / how often to drain (e.g. also on app resume).
 */
export function usePendingWrites(
  opts: UsePendingWritesOptions = {},
): UsePendingWritesResult {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const [pending, setPending] = useState<PendingWrite[]>(() => readQueueSync());
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const persist = useCallback((next: PendingWrite[]) => {
    pendingRef.current = next;
    persistQueue(next);
    setPending(next);
  }, []);

  // Native hydration: the synchronous initial read returns [] on native; pull
  // the persisted queue from AsyncStorage and adopt it if non-empty.
  useEffect(() => {
    if (canAccessWebStorage()) return;
    let cancelled = false;
    void (async () => {
      const raw = await readAsync(STORAGE_KEY);
      if (cancelled) return;
      const queue = parseQueue(raw);
      if (queue.length === 0) return;
      pendingRef.current = queue;
      setPending(queue);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enqueue = useCallback(<TArgs>(kind: string, args: TArgs): string => {
    const entry: PendingWrite<TArgs> = {
      id: makeId(),
      kind,
      args,
      enqueuedAtMs: Date.now(),
      attempts: 0,
    };
    persist([...pendingRef.current, entry as PendingWrite]);
    return entry.id;
  }, [persist]);

  const remove = useCallback((id: string) => {
    persist(pendingRef.current.filter((e) => e.id !== id));
  }, [persist]);

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  const replay = useCallback(async (replayFn: PendingWriteReplayFn) => {
    // Snapshot the queue up-front so entries enqueued mid-drain are left
    // for the next replay tick (avoids re-entrancy issues).
    const snapshot = pendingRef.current.slice();
    let replayed = 0;
    let dropped = 0;
    const survivors: PendingWrite[] = [];
    for (const entry of snapshot) {
      let succeeded = false;
      try {
        succeeded = await replayFn(entry);
      } catch {
        succeeded = false;
      }
      if (succeeded) {
        replayed += 1;
        continue;
      }
      const nextAttempts = entry.attempts + 1;
      if (nextAttempts >= maxAttempts) {
        dropped += 1;
        continue;
      }
      survivors.push({ ...entry, attempts: nextAttempts });
    }
    // Preserve any entries enqueued while we were draining — they sit at
    // the tail of the queue, survivors sit at the head (oldest-first).
    const latest = pendingRef.current;
    const enqueuedDuringDrain = latest.filter((e) => !snapshot.some((s) => s.id === e.id));
    persist([...survivors, ...enqueuedDuringDrain]);
    return { replayed, remaining: survivors.length + enqueuedDuringDrain.length, dropped };
  }, [maxAttempts, persist]);

  // Re-hydrate from storage whenever the window gains focus — another tab
  // may have mutated the same queue. (Web only — native is single-instance.)
  useEffect(() => {
    if (!canAccessWebStorage()) return;
    const onFocus = () => {
      const stored = readQueueSync();
      if (JSON.stringify(stored) !== JSON.stringify(pendingRef.current)) {
        setPending(stored);
        pendingRef.current = stored;
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return { pending, enqueue, remove, clear, replay };
}
