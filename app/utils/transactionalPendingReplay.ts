import type { PendingWrite, PendingWriteReplayFn, ReplaySummary } from '../hooks/usePendingWrites';
import type { PendingWriteStore } from './pendingWriteStore';

export const PENDING_REPLAY_LEASE_MS = 30_000;
export const MAX_PENDING_REPLAY_BATCH = 20;
export const MAX_PENDING_REPLAY_DURATION_MS = 45_000;

/** Persistent ownership survives tab crashes. Every result commits separately
 * under the same fencing token, so a stale/suspended worker cannot overwrite a
 * replacement worker. HTTP idempotency still resolves timeout-after-commit. */
export const replayTransactionalPending = async (options: {
  store: PendingWriteStore; key: string; token: string; current: () => boolean;
  replay: PendingWriteReplayFn; maxAttempts: number | null;
  backoffMs?: (attempts: number) => number; ignoreBackoff?: boolean;
}): Promise<ReplaySummary> => {
  const { store, key, token, current } = options;
  const summary: ReplaySummary = { replayed: 0, remaining: 0, dropped: 0, failed: 0, paused: false };
  if (!current() || !await store.claim(key, token, PENDING_REPLAY_LEASE_MS)) return summary;
  let owned = true;
  const heartbeat = setInterval(() => {
    if (!current()) { owned = false; return; }
    void store.renew(key, token, PENDING_REPLAY_LEASE_MS).then(ok => { if (!ok) owned = false; }).catch(() => { owned = false; });
  }, 10_000);
  const started = Date.now();
  try {
    const eligibleAt = Date.now();
    const snapshot = (await store.read(key)).filter(entry => entry.status !== 'failed'
      && (options.ignoreBackoff || (entry.nextAttemptAtMs ?? 0) <= eligibleAt))
      .sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs || a.id.localeCompare(b.id)).slice(0, MAX_PENDING_REPLAY_BATCH);
    for (const initial of snapshot) {
      if (!owned || !current() || Date.now() - started >= MAX_PENDING_REPLAY_DURATION_MS) break;
      if (!await store.renew(key, token, PENDING_REPLAY_LEASE_MS)) break;
      const entry = (await store.read(key)).find(candidate => candidate.id === initial.id);
      if (!entry || entry.status === 'failed' || (!options.ignoreBackoff && (entry.nextAttemptAtMs ?? 0) > Date.now())) continue;
      if (!current() || !owned || Date.now() - started >= MAX_PENDING_REPLAY_DURATION_MS) break;
      let result;
      try { result = await options.replay(entry); } catch { result = false; }
      if (!current() || !owned) break;
      const outcome = typeof result === 'boolean' ? result ? 'done' : 'retry' : result.outcome;
      const error = typeof result === 'boolean' ? undefined : result.error;
      // Discard/edit in another tab wins over the snapshot this request used.
      let committed = false;
      await store.update(key, entries => entries.flatMap(candidate => {
        if (candidate.id !== entry.id || JSON.stringify(candidate) !== JSON.stringify(entry)) return [candidate];
        committed = true;
        if (outcome === 'done') return [];
        if (outcome === 'pause') return [{ ...entry, lastError: error }];
        const attempts = entry.attempts + 1;
        if (outcome === 'failed') return [{ ...entry, attempts, status: 'failed', lastError: error } satisfies PendingWrite];
        if (options.maxAttempts !== null && attempts >= options.maxAttempts) return [];
        return [{ ...entry, attempts, lastError: error, nextAttemptAtMs: options.backoffMs ? Date.now() + options.backoffMs(attempts) : undefined }];
      }), token);
      if (outcome === 'pause') { summary.paused = true; break; }
      if (!committed) continue;
      if (outcome === 'done') summary.replayed += 1;
      else if (outcome === 'failed') summary.failed += 1;
      else if (options.maxAttempts !== null && entry.attempts + 1 >= options.maxAttempts) summary.dropped += 1;
    }
    if (current()) summary.remaining = (await store.read(key)).length;
    return summary;
  } finally {
    clearInterval(heartbeat);
    await store.release(key, token).catch(() => undefined);
  }
};
