// Best-effort cross-tab replay lock for browsers without Web Locks (gap-closing plan §5.3).
//
// localStorage has no compare-and-swap, so this is a claim-then-verify lease: write our token,
// wait a beat so a racing tab's write lands, then re-read and proceed only if ours survived. It
// shrinks the double-replay window rather than eliminating it, which is acceptable because every
// replayed write also carries an Idempotency-Key. Financial queues do not rely on it; they use the
// IndexedDB lease in pendingWriteStore.web.ts.

export const REPLAY_LOCK_LEASE_MS = 30_000;
export const REPLAY_LOCK_RENEW_MS = 10_000;
export const REPLAY_LOCK_VERIFY_MS = 30;

type Lease = { token: string; until: number };

const storage = (): Storage | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage ?? null; } catch { return null; }
};
const read = (store: Storage, key: string): Lease | null => {
  try {
    const parsed = JSON.parse(store.getItem(key) ?? 'null') as Partial<Lease> | null;
    return parsed && typeof parsed.token === 'string' && Number.isFinite(parsed.until) ? { token: parsed.token, until: Number(parsed.until) } : null;
  } catch { return null; }
};
/** A lease that ends further away than one lease term is from a clock that has since moved back; treat it as expired. */
const live = (lease: Lease | null, now: number): lease is Lease =>
  Boolean(lease && lease.until > now && lease.until - now <= REPLAY_LOCK_LEASE_MS * 2);

const newToken = (): string => {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID(); } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

/** Runs `work` while holding the lease. Returns null if another tab holds it. Without any storage, runs `work` unlocked (single-instance native). */
export const withStorageLease = async <T,>(name: string, work: () => Promise<T>): Promise<T | null> => {
  const store = storage();
  if (!store) return work();
  const key = `stp.replay-lock.${name}`;
  const token = newToken();
  try {
    if (live(read(store, key), Date.now())) return null;
    store.setItem(key, JSON.stringify({ token, until: Date.now() + REPLAY_LOCK_LEASE_MS }));
    await new Promise(resolve => setTimeout(resolve, REPLAY_LOCK_VERIFY_MS));
    if (read(store, key)?.token !== token) return null;
  } catch {
    // Storage that rejects writes cannot be coordinated; do not strand the user's queue behind it.
    return work();
  }
  const heartbeat = setInterval(() => {
    try { if (read(store, key)?.token === token) store.setItem(key, JSON.stringify({ token, until: Date.now() + REPLAY_LOCK_LEASE_MS })); } catch { /* lease simply lapses */ }
  }, REPLAY_LOCK_RENEW_MS);
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    try { if (read(store, key)?.token === token) store.removeItem(key); } catch { /* lapses on its own */ }
  }
};
