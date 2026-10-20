import { createIdempotencyKey } from '../utils/idempotencyKey';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canAccessWebStorage, readAsync, readAsyncOrThrow, readSync, writeAsync, writeSync } from '../utils/persistentStorage';

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
  /** How many times we've attempted to replay. */
  attempts: number;
  /** `failed` entries are never retried automatically; they wait for the user (`retry` / `remove`). */
  status?: 'pending' | 'failed';
  /** Earliest time the next automatic replay may try this entry (backoff). */
  nextAttemptAtMs?: number;
  /** Last user-facing reason this entry has not synced. */
  lastError?: string;
}

const DEFAULT_STORAGE_KEY = 'stp.pending-writes';
const DEFAULT_MAX_ATTEMPTS = 5;

const parseQueue = (raw: string | null, strict = false): PendingWrite[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(entry => entry && typeof entry.id === 'string'
      && typeof entry.kind === 'string' && Number.isFinite(entry.enqueuedAtMs) && Number.isFinite(entry.attempts))) {
      throw new Error('Unreadable saved queue');
    }
    return parsed as PendingWrite[];
  } catch {
    if (strict) throw new Error('Unreadable saved queue; keep it for recovery');
    return [];
  }
};

const readQueueSync = (key: string): PendingWrite[] => parseQueue(readSync(key));

const persistQueue = (key: string, queue: PendingWrite[]): void => {
  const serialized = JSON.stringify(queue);
  if (canAccessWebStorage()) {
    writeSync(key, serialized);
  } else {
    void writeAsync(key, serialized);
  }
};

/** Writes then reads back, so callers can tell the user "Saved on this device" only when it is true. */
const persistQueueDurably = async (key: string, queue: PendingWrite[]): Promise<boolean> => {
  const serialized = JSON.stringify(queue);
  try {
    await writeAsync(key, serialized);
    return (await readAsync(key)) === serialized;
  } catch {
    return false;
  }
};

const makeId = (): string => createIdempotencyKey('queue');

const mergeById = (persisted: PendingWrite[], current: PendingWrite[]): PendingWrite[] => {
  const seen = new Set(persisted.map((e) => e.id));
  return [...persisted, ...current.filter((e) => !seen.has(e.id))];
};

/**
 * What a replay function reports for one entry. A plain boolean is the
 * original contract (true = applied, false = retry later).
 *  - `done`:   applied; remove it.
 *  - `retry`:  transient failure; keep it and back off.
 *  - `failed`: will never succeed as-is; keep it, mark `failed`, wait for the user.
 *  - `pause`:  cannot proceed for now (e.g. signed out); stop the drain and leave every
 *              remaining entry untouched without spending an attempt.
 */
export type PendingWriteReplayResult =
  | boolean
  | { outcome: 'done' | 'retry' | 'failed' | 'pause'; error?: string };

export type PendingWriteReplayFn = (entry: PendingWrite) => Promise<PendingWriteReplayResult>;

export interface UsePendingWritesOptions {
  /** Maximum replay attempts before an entry is dropped. Default 5. `null` never drops an entry. */
  maxAttempts?: number | null;
  /** Storage key. Scope it per account so another user on the same device never sees or replays this queue. */
  storageKey?: string;
  /** Delay before an entry may be retried automatically, given its failed-attempt count. Default: immediate. */
  backoffMs?: (attempts: number) => number;
}

export interface ReplaySummary {
  replayed: number;
  remaining: number;
  dropped: number;
  failed: number;
  paused: boolean;
}

export interface UsePendingWritesResult {
  /** Current queue snapshot, ordered oldest-first. */
  pending: PendingWrite[];
  /** Queue a new write and return its generated id. */
  enqueue: <TArgs>(kind: string, args: TArgs) => string;
  /** Like `enqueue`, but resolves only after the write is read back from storage. `null` means it was NOT saved. */
  enqueueDurable: <TArgs>(kind: string, args: TArgs) => Promise<string | null>;
  replaceFailedDurable: <TArgs>(id: string, args: TArgs) => Promise<boolean>;
  /** Remove a single entry by id (no-op if not found). */
  remove: (id: string) => void;
  /** Make a `failed` entry eligible for replay again. */
  retry: (id: string) => void;
  /** Clear the full queue. Used by "give up" UI affordances. */
  clear: () => void;
  /** Iterate the queue, calling `replayFn` per entry. Removes ones that succeed. */
  replay: (replayFn: PendingWriteReplayFn, options?: { ignoreBackoff?: boolean }) => Promise<ReplaySummary>;
}

type LockManagerLike = {
  request: (name: string, options: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<unknown>) => Promise<unknown>;
};

/** Runs `work` only if no other tab/window holds the queue's replay lock. Falls back to running when Web Locks is unavailable. */
const withReplayLock = async <T,>(name: string, work: () => Promise<T>): Promise<T | null> => {
  const locks = (typeof navigator !== 'undefined' ? (navigator as { locks?: LockManagerLike }).locks : undefined) ?? null;
  if (!locks) return work();
  let result: T | null = null;
  await locks.request(`replay:${name}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return null;
    result = await work();
    return null;
  });
  return result;
};

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
  const maxAttempts = opts.maxAttempts === undefined ? DEFAULT_MAX_ATTEMPTS : opts.maxAttempts;
  const storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
  const backoffMs = opts.backoffMs;

  const [pending, setPending] = useState<PendingWrite[]>(() => readQueueSync(storageKey));
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const keyRef = useRef(storageKey);
  const replayingRef = useRef(false);
  const generationRef = useRef(0);
  const mutationRef = useRef(0);
  useEffect(() => () => { generationRef.current += 1; }, []);
  const enqueueTail = useRef<Promise<unknown>>(Promise.resolve());
  // Fence before effects run: async completions may arrive between render and commit.
  if (keyRef.current !== storageKey) {
    keyRef.current = storageKey;
    generationRef.current += 1;
    pendingRef.current = readQueueSync(storageKey);
  }

  const persist = useCallback((next: PendingWrite[]) => {
    mutationRef.current += 1;
    pendingRef.current = next;
    persistQueue(keyRef.current, next);
    setPending(next);
  }, []);

  // Account switch (a different storage key): never carry the previous account's entries over.
  useEffect(() => {
    const next = pendingRef.current;
    pendingRef.current = next;
    setPending(next);
  }, [storageKey]);

  // Native hydration: the synchronous initial read returns [] on native; pull the persisted queue from
  // AsyncStorage and MERGE it with anything enqueued before hydration finished, so a fast first
  // enqueue can't overwrite the stored queue.
  useEffect(() => {
    if (canAccessWebStorage()) return;
    let cancelled = false;
    const key = storageKey;
    const mutation = mutationRef.current;
    void (async () => {
      const raw = await readAsync(key);
      if (cancelled || keyRef.current !== key || mutationRef.current !== mutation) return;
      const persisted = parseQueue(raw);
      if (persisted.length === 0) return;
      const merged = mergeById(persisted, pendingRef.current);
      pendingRef.current = merged;
      setPending(merged);
      if (merged.length !== persisted.length) persistQueue(key, merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const buildEntry = <TArgs,>(kind: string, args: TArgs): PendingWrite => ({
    id: makeId(),
    kind,
    args: args as unknown,
    enqueuedAtMs: Date.now(),
    attempts: 0,
    status: 'pending',
  });

  const enqueue = useCallback(<TArgs>(kind: string, args: TArgs): string => {
    const entry = buildEntry(kind, args);
    persist([...pendingRef.current, entry]);
    return entry.id;
  }, [persist]);

  const enqueueDurable = useCallback(<TArgs,>(kind: string, args: TArgs): Promise<string | null> => {
    const key = keyRef.current;
    const generation = generationRef.current;
    const entry = buildEntry(kind, args);
    const work = enqueueTail.current.then(async () => {
      if (key !== keyRef.current || generation !== generationRef.current) return null;
      // Read persisted native entries before the first write, even if hydration is still pending.
      const stored = parseQueue(await readAsyncOrThrow(key), true);
      if (key !== keyRef.current || generation !== generationRef.current) return null;
      const next = [...mergeById(stored, pendingRef.current), entry];
      if (!await persistQueueDurably(key, next)) return null;
      if (key !== keyRef.current || generation !== generationRef.current) return null;
      mutationRef.current += 1;
      pendingRef.current = next;
      setPending(next);
      return entry.id;
    });
    enqueueTail.current = work.catch(() => undefined);
    return work.catch(() => null);
  }, []);

  const replaceFailedDurable = useCallback(async <TArgs,>(id: string, args: TArgs): Promise<boolean> => {
    const key = keyRef.current;
    const generation = generationRef.current;
    const work = enqueueTail.current.then(async () => {
      if (generation !== generationRef.current) return false;
      const original = pendingRef.current.find(entry => entry.id === id);
      // Unknown outcomes must retain their original idempotency key until reconciled.
      if (!original || original.status !== 'failed') return false;
      const next = pendingRef.current.map(entry => entry.id === id ? { ...entry, args, attempts: 0, status: 'pending' as const, lastError: undefined, nextAttemptAtMs: undefined } : entry);
      if (!await persistQueueDurably(key, next)) return false;
      if (generation !== generationRef.current) return false;
      mutationRef.current += 1;
      pendingRef.current = next;
      setPending(next);
      return true;
    });
    enqueueTail.current = work.catch(() => undefined);
    return work;
  }, []);

  const remove = useCallback((id: string) => {
    persist(pendingRef.current.filter((e) => e.id !== id));
  }, [persist]);

  const retry = useCallback((id: string) => {
    persist(pendingRef.current.map((e) => (e.id === id ? { ...e, status: 'pending', nextAttemptAtMs: undefined } : e)));
  }, [persist]);

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  const replay = useCallback(async (replayFn: PendingWriteReplayFn, options?: { ignoreBackoff?: boolean }): Promise<ReplaySummary> => {
    const empty: ReplaySummary = { replayed: 0, remaining: pendingRef.current.length, dropped: 0, failed: 0, paused: false };
    // One drain at a time in this tab, and one tab at a time per queue, so a resume + reconnect
    // (or two open tabs) cannot send the same entry twice concurrently.
    if (replayingRef.current) return empty;
    replayingRef.current = true;
    const replayKey = keyRef.current;
    const generation = generationRef.current;
    const current = () => keyRef.current === replayKey && generationRef.current === generation;
    try {
      const summary = await withReplayLock(replayKey, async (): Promise<ReplaySummary> => {
        // Snapshot the queue up-front so entries enqueued mid-drain are left
        // for the next replay tick (avoids re-entrancy issues).
        const snapshot = pendingRef.current.slice();
        const now = Date.now();
        let replayed = 0;
        let dropped = 0;
        let failed = 0;
        let paused = false;
        const updated = new Map<string, PendingWrite | null>();
        for (let i = 0; i < snapshot.length; i += 1) {
          const entry = snapshot[i]!;
          if (paused || !current()) break;
          if (entry.status === 'failed') continue;
          if (!options?.ignoreBackoff && entry.nextAttemptAtMs && entry.nextAttemptAtMs > now) continue;
          let result: PendingWriteReplayResult = false;
          try {
            result = await replayFn(entry);
          } catch {
            result = false;
          }
          const outcome = typeof result === 'boolean' ? (result ? 'done' : 'retry') : result.outcome;
          const error = typeof result === 'boolean' ? undefined : result.error;
          if (outcome === 'done') {
            replayed += 1;
            updated.set(entry.id, null);
          } else if (outcome === 'pause') {
            paused = true;
            if (error) updated.set(entry.id, { ...entry, lastError: error });
          } else if (outcome === 'failed') {
            failed += 1;
            updated.set(entry.id, { ...entry, status: 'failed', attempts: entry.attempts + 1, lastError: error });
          } else {
            const nextAttempts = entry.attempts + 1;
            if (maxAttempts !== null && nextAttempts >= maxAttempts) {
              dropped += 1;
              updated.set(entry.id, null);
            } else {
              updated.set(entry.id, {
                ...entry,
                attempts: nextAttempts,
                lastError: error,
                nextAttemptAtMs: backoffMs ? Date.now() + backoffMs(nextAttempts) : undefined,
              });
            }
          }
        }
        if (!current()) return { ...empty, paused: true };
        // Apply results to the LATEST queue so entries enqueued or removed while draining are preserved.
        const next = pendingRef.current.flatMap((e) => {
          if (!updated.has(e.id)) return [e];
          const replacement = updated.get(e.id);
          return replacement ? [replacement] : [];
        });
        persist(next);
        return { replayed, remaining: next.length, dropped, failed, paused };
      });
      return summary ?? empty;
    } finally {
      replayingRef.current = false;
    }
  }, [backoffMs, maxAttempts, persist]);

  // Re-hydrate from storage whenever the window gains focus — another tab
  // may have mutated the same queue. (Web only — native is single-instance.)
  useEffect(() => {
    if (!canAccessWebStorage()) return;
    const onFocus = () => {
      const stored = readQueueSync(keyRef.current);
      if (JSON.stringify(stored) !== JSON.stringify(pendingRef.current)) {
        setPending(stored);
        pendingRef.current = stored;
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return { pending: keyRef.current === storageKey ? pendingRef.current : [], enqueue, enqueueDurable, replaceFailedDurable, remove, retry, clear, replay };
}
