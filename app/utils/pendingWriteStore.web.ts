import type { PendingWriteStore } from './pendingWriteStore';
import type { PendingWrite } from '../hooks/usePendingWrites';
import { parsePendingWriteQueue } from './pendingWriteValidation';

type Row = { raw: string; retired: Record<string, number>; lease?: { token: string; until: number } };
const DATABASE = 'wanderbunnies-pending-writes-v1';
const STORE = 'queues';
const RETIRED_MS = 30 * 86400_000;
const MAX_CHARACTERS = 1_250_000; // <= 5 MB UTF-8, excluding bounded bookkeeping.
const MAX_ENTRIES = 2000;
const MAX_RETIRED = 10_000;
const CHANGE_KEY = 'stp.pending-expenses.change';
let opening: Promise<IDBDatabase> | undefined;
const listeners = new Map<string, Set<() => void>>();
let channel: BroadcastChannel | undefined;

const emit = (key: string) => listeners.get(key)?.forEach(callback => callback());
const broadcast = (key: string) => {
  emit(key); channel?.postMessage({ key });
  // A compatibility invalidation hint, containing no expense payload. Focus /
  // resume also refreshes when a browser rejects this optional notification.
  try { localStorage.setItem(CHANGE_KEY, JSON.stringify({ key, nonce: Math.random() })); } catch { /* optional */ }
};
const open = (): Promise<IDBDatabase> => {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Transactional expense storage is unavailable.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Close older WanderBunnies tabs and try again.')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); opening = undefined; };
      db.onclose = () => { opening = undefined; };
      resolve(db);
    };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
};

/** Every read/modify/write and lease check shares one IndexedDB transaction.
 * The legacy source is kept as a recovery copy: localStorage has no atomic CAS
 * with IndexedDB and an older tab may still write it. Never delete that writer's
 * new financial work as a side effect of migration. */
const transact = async <T>(key: string, work: (row: Row) => T): Promise<T> => {
  const db = await open();
  const legacy = localStorage.getItem(key);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(key);
    let result: T, failure: unknown, rawChanged = false;
    request.onsuccess = () => {
      try {
        const row: Row = request.result ?? { raw: '[]', retired: {} };
        const before = JSON.stringify(row), beforeRaw = row.raw;
        const entries = parsePendingWriteQueue(row.raw, true);
        if (!row.retired || typeof row.retired !== 'object' || Array.isArray(row.retired)) throw new Error('Unreadable queue bookkeeping');
        if (legacy !== null) {
          const imported = parsePendingWriteQueue(legacy, true);
          const ids = new Set(entries.map(entry => entry.id));
          const merged = [...entries, ...imported.filter(entry => !ids.has(entry.id) && !Object.prototype.hasOwnProperty.call(row.retired, entry.id))];
          row.raw = JSON.stringify(merged);
          if ((row.raw.length > MAX_CHARACTERS || merged.length > MAX_ENTRIES) && row.raw.length > beforeRaw.length) {
            throw new Error('The legacy expense queue exceeds the migration bound. Export it for recovery.');
          }
        }
        result = work(row);
        rawChanged = row.raw !== beforeRaw;
        if (JSON.stringify(row) !== before || request.result === undefined) store.put(row, key);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Expense storage transaction was interrupted.'));
    tx.onerror = () => { failure ??= tx.error; };
    tx.oncomplete = () => {
      // Completion, not the put request's success event, is the durability boundary.
      if (rawChanged) broadcast(key);
      resolve(result);
    };
  });
};

export const transactionalPendingWriteStore: PendingWriteStore = {
  read: key => transact(key, row => parsePendingWriteQueue(row.raw, true)),
  update: (key, change, leaseToken) => transact(key, row => {
    if (leaseToken && (row.lease?.token !== leaseToken || row.lease.until <= Date.now())) throw new Error('Expense replay lease was lost');
    const before = parsePendingWriteQueue(row.raw, true);
    const next = change(before);
    const raw = JSON.stringify(next);
    parsePendingWriteQueue(raw, true);
    if (raw.length > MAX_CHARACTERS && raw.length > row.raw.length) throw new Error('Saved expense storage is full.');
    if (next.length > before.length && (next.length > MAX_ENTRIES || Object.keys(row.retired).length >= MAX_RETIRED)) throw new Error('Saved expense recovery bookkeeping is full.');
    const ids = new Set(next.map(entry => entry.id));
    for (const entry of before) if (!ids.has(entry.id)) row.retired[entry.id] = Date.now();
    // Keep tombstones while an unmodified old client can reintroduce its copy.
    // This backup is a separate, explicit cleanup gate after old clients retire.
    if (localStorage.getItem(key) === null) {
      for (const [id, retiredAt] of Object.entries(row.retired)) if (retiredAt < Date.now() - RETIRED_MS) delete row.retired[id];
    }
    row.raw = raw;
    return next;
  }),
  claim: (key, token, leaseMs) => transact(key, row => {
    if (row.lease && row.lease.until > Date.now()) return false;
    row.lease = { token, until: Date.now() + leaseMs }; return true;
  }),
  renew: (key, token, leaseMs) => transact(key, row => {
    if (row.lease?.token !== token || row.lease.until <= Date.now()) return false;
    row.lease.until = Date.now() + leaseMs; return true;
  }),
  release: (key, token) => transact(key, row => { if (row.lease?.token === token) delete row.lease; }),
  recovery: async key => {
    const db = await open();
    const stored = await new Promise<Row | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'), request = tx.objectStore(STORE).get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
    const legacy = localStorage.getItem(key);
    return stored || legacy !== null ? JSON.stringify({ transactional: stored?.raw ?? null, legacy }) : null;
  },
  subscribe: (key, callback) => {
    const callbacks = listeners.get(key) ?? new Set(); callbacks.add(callback); listeners.set(key, callbacks);
    if (!channel && typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('wanderbunnies-pending-write-changes');
      channel.onmessage = event => { if (typeof event.data?.key === 'string') emit(event.data.key); };
    }
    const changed = (event: StorageEvent) => {
      if (event.key === key) callback();
      else if (event.key === CHANGE_KEY) {
        try { if (JSON.parse(event.newValue || '{}').key === key) callback(); } catch { /* ignore unrelated/corrupt hint */ }
      }
    };
    window.addEventListener('storage', changed);
    return () => {
      callbacks.delete(callback); if (!callbacks.size) listeners.delete(key);
      window.removeEventListener('storage', changed);
      if (!listeners.size) { channel?.close(); channel = undefined; }
    };
  },
};
