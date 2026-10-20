import { replayTransactionalPending, MAX_PENDING_REPLAY_BATCH, MAX_PENDING_REPLAY_DURATION_MS } from '../utils/transactionalPendingReplay';
import type { PendingWrite, PendingWriteReplayFn } from '../hooks/usePendingWrites';
import type { PendingWriteStore } from '../utils/pendingWriteStore';

// Models atomic storage boundaries, not IndexedDB internals. Real two-tab storage
// fencing has its own browser check in scripts/check-queue-locks.cjs.
class Store implements PendingWriteStore {
  entries: PendingWrite[] = [];
  lease: { token: string; until: number } | undefined;
  async read() { return structuredClone(this.entries); }
  async update(_key: string, change: (entries: PendingWrite[]) => PendingWrite[], token?: string) {
    if (token && (this.lease?.token !== token || this.lease.until <= Date.now())) throw new Error('Lease lost');
    this.entries = structuredClone(change(structuredClone(this.entries)));
    return this.read();
  }
  async claim(_key: string, token: string, ms: number) {
    if (this.lease && this.lease.until > Date.now()) return false;
    this.lease = { token, until: Date.now() + ms }; return true;
  }
  async renew(_key: string, token: string, ms: number) {
    if (this.lease?.token !== token || this.lease.until <= Date.now()) return false;
    this.lease.until = Date.now() + ms; return true;
  }
  async release(_key: string, token: string) { if (this.lease?.token === token) this.lease = undefined; }
  async recovery() { return JSON.stringify(this.entries); }
  subscribe() { return () => undefined; }
}
const entry = (n: number): PendingWrite => ({ id: `entry-${n}`, kind: 'createExpense', args: { operationKey: `stable-${n}` }, enqueuedAtMs: n, attempts: 0 });
const drain = (store: Store, replay: PendingWriteReplayFn = async () => true, extra: Partial<Parameters<typeof replayTransactionalPending>[0]> = {}) =>
  replayTransactionalPending({ store, key: 'owner-a', token: 'worker-a', current: () => true, maxAttempts: null, replay, ...extra });
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-20T12:00:00Z')); });
afterEach(() => jest.useRealTimers());

it('does not let a full batch of delayed/failed entries starve a later eligible expense', async () => {
  const store = new Store();
  store.entries = Array.from({ length: MAX_PENDING_REPLAY_BATCH }, (_, n) => ({ ...entry(n), nextAttemptAtMs: Date.now() + 60_000 }));
  store.entries.push({ ...entry(21), status: 'failed' }, entry(22));
  const send = jest.fn(async () => true);
  expect((await drain(store, send)).replayed).toBe(1);
  expect(send.mock.calls).toHaveLength(1);
  expect(store.entries.map(e => e.id)).not.toContain('entry-22');
  expect(store.entries).toHaveLength(21);
});

it('bounds a drain and leaves the rest available to the next resume', async () => {
  const store = new Store(); store.entries = Array.from({ length: 25 }, (_, n) => entry(n));
  expect((await drain(store)).replayed).toBe(20);
  expect(store.entries).toHaveLength(5);
  expect((await drain(store)).replayed).toBe(5);
  expect(store.entries).toHaveLength(0);
  expect(store.lease).toBeUndefined();
});

it('starts no additional request after the elapsed-time budget', async () => {
  const store = new Store(); store.entries = [entry(1), entry(2)];
  const send = jest.fn(async () => { await jest.advanceTimersByTimeAsync(MAX_PENDING_REPLAY_DURATION_MS); return true; });
  expect((await drain(store, send)).replayed).toBe(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.entries.map(e => e.id)).toEqual(['entry-2']);
});

it('checks the budget again after asynchronous storage reads', async () => {
  const store = new Store(); store.entries = [entry(1)];
  const read = store.read.bind(store); let reads = 0;
  jest.spyOn(store, 'read').mockImplementation(async () => {
    if (++reads === 2) jest.setSystemTime(Date.now() + MAX_PENDING_REPLAY_DURATION_MS);
    return read();
  });
  const send = jest.fn(async () => true); await drain(store, send);
  expect(send).not.toHaveBeenCalled(); expect(store.entries).toHaveLength(1);
});

it('fences account switches and leaves the unfinished operation key intact', async () => {
  const store = new Store(); store.entries = [entry(1), entry(2)]; let active = true;
  const send = jest.fn(async () => { active = false; return true; });
  await drain(store, send, { current: () => active });
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.entries).toEqual([entry(1), entry(2)]);
  expect(store.lease).toBeUndefined();
});

it('keeps committed progress after interruption without removing the next expense', async () => {
  const store = new Store(); store.entries = [entry(1), entry(2)];
  const update = store.update.bind(store); let writes = 0;
  jest.spyOn(store, 'update').mockImplementation(async (...args) => {
    if (++writes === 2) throw new Error('Storage interrupted');
    return update(...args);
  });
  await expect(drain(store)).rejects.toThrow('Storage interrupted');
  expect(store.entries).toEqual([entry(2)]); expect(store.lease).toBeUndefined();
});

it('does not overwrite a replacement worker or resurrect a discarded expense', async () => {
  const store = new Store(); store.entries = [entry(1)];
  await expect(drain(store, async () => {
    store.lease = { token: 'worker-b', until: Date.now() + 30_000 }; return true;
  })).rejects.toThrow('Lease lost');
  expect(store.entries).toEqual([entry(1)]); expect(store.lease?.token).toBe('worker-b');
  store.lease = undefined;
  await drain(store, async () => { store.entries = []; return { outcome: 'retry', error: 'No connection' }; });
  expect(store.entries).toEqual([]);
});

it('pauses a 401 without consuming attempts and retains permanent rejections', async () => {
  const store = new Store(); store.entries = [entry(1), entry(2)];
  expect((await drain(store, async () => ({ outcome: 'pause', error: 'Sign in' }))).paused).toBe(true);
  expect(store.entries.map(e => e.attempts)).toEqual([0, 0]);
  const summary = await drain(store, async () => ({ outcome: 'failed', error: 'Access revoked' }));
  expect(summary.failed).toBe(2); expect(summary.dropped).toBe(0);
  expect(store.entries.every(e => e.status === 'failed')).toBe(true);
});
