import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PendingWriteStore } from './pendingWriteStore';
import { parsePendingWriteQueue } from './pendingWriteValidation';
import { exportNativeCiphertext, NativeStorageRecoveryError, readNativeValue, serializeNativeStorage, withNativeDatabase, writeNativeValue } from './nativeEncryptedStorage';
import * as Crypto from 'expo-crypto';

type Row = { raw: string; retired: Record<string, number>; lease?: { token: string; until: number } };
const listeners = new Map<string, Set<() => void>>();
const emit = (key: string) => listeners.get(key)?.forEach(callback => callback());
const MAX_CHARACTERS = 1_250_000, MAX_ENTRIES = 2000, MAX_RETIRED = 10_000;

const parseRow = (value: string): Row => {
  const row = JSON.parse(value) as Row;
  parsePendingWriteQueue(row.raw, true);
  if (!row.retired || typeof row.retired !== 'object' || Array.isArray(row.retired)
    || !Object.values(row.retired).every(Number.isFinite)
    || (row.lease && (typeof row.lease.token !== 'string' || !Number.isFinite(row.lease.until)))) {
    throw new Error('Unreadable saved expense bookkeeping');
  }
  return row;
};

const bounded = (raw: string) => {
  const entries = parsePendingWriteQueue(raw, true);
  if (raw.length > MAX_CHARACTERS || entries.length > MAX_ENTRIES) throw new Error('Saved expense storage is full. Export a recovery copy.');
  return entries;
};

/** Commit migration and every lease/update in SQLCipher before removing the
 * plaintext source. A crash or full disk leaves the source intact. Tombstones
 * also prevent resurrection if plaintext cleanup failed on the last launch. */
const transact = <T>(key: string, work: (row: Row) => T): Promise<T> => serializeNativeStorage(key, async () => {
  const legacy = await AsyncStorage.getItem(key);
  const result = await withNativeDatabase(key, async db => {
    const stored = await readNativeValue(db);
    const row = stored === null ? { raw: '[]', retired: {} } satisfies Row : parseRow(stored);
    if (legacy === null) {
      for (const [id, retiredAt] of Object.entries(row.retired)) {
        if (retiredAt < Date.now() - 30 * 86400_000) delete row.retired[id];
      }
    }
    if (legacy !== null) {
      const entries = parsePendingWriteQueue(row.raw, true), ids = new Set(entries.map(entry => entry.id));
      row.raw = JSON.stringify([...entries, ...parsePendingWriteQueue(legacy, true)
        .filter(entry => !ids.has(entry.id) && !Object.prototype.hasOwnProperty.call(row.retired, entry.id))]);
      bounded(row.raw);
    }
    const next = work(row);
    await writeNativeValue(db, JSON.stringify(row));
    return next;
  });
  // A cleanup error must not report a committed financial write as failed.
  // It will be retried on the next access, with tombstones protecting removals.
  if (legacy !== null) await AsyncStorage.removeItem(key).catch(() => undefined);
  return result;
});

export const transactionalPendingWriteStore: PendingWriteStore = {
  read: key => transact(key, row => parsePendingWriteQueue(row.raw, true)),
  update: async (key, change, leaseToken) => {
    const result = await transact(key, row => {
      if (leaseToken && (row.lease?.token !== leaseToken || row.lease.until <= Date.now())) throw new Error('Expense replay lease was lost');
      const before = parsePendingWriteQueue(row.raw, true), next = change(before), raw = JSON.stringify(next);
      bounded(raw);
      const retired = { ...row.retired }, ids = new Set(next.map(entry => entry.id));
      for (const entry of before) if (!ids.has(entry.id)) Object.defineProperty(retired, entry.id, { value: Date.now(), enumerable: true, configurable: true, writable: true });
      if (Object.keys(retired).length > MAX_RETIRED) throw new Error('Saved expense recovery bookkeeping is full. Export a recovery copy.');
      row.raw = raw; row.retired = retired;
      return next;
    });
    emit(key); return result;
  },
  claim: (key, token, leaseMs) => transact(key, row => {
    if (row.lease && row.lease.until > Date.now() && row.lease.until - Date.now() <= leaseMs * 2) return false;
    row.lease = { token, until: Date.now() + leaseMs }; return true;
  }),
  renew: (key, token, leaseMs) => transact(key, row => {
    if (row.lease?.token !== token || row.lease.until <= Date.now()) return false;
    row.lease.until = Date.now() + leaseMs; return true;
  }),
  release: (key, token) => transact(key, row => { if (row.lease?.token === token) delete row.lease; }),
  recovery: key => serializeNativeStorage(key, async () => {
    const legacy = await AsyncStorage.getItem(key);
    try {
      return await withNativeDatabase(key, async db => {
        const stored = await readNativeValue(db);
        let raw: string | null = stored;
        try { if (stored !== null && typeof (JSON.parse(stored) as Row)?.raw === 'string') raw = (JSON.parse(stored) as Row).raw; } catch { /* preserve original */ }
        return JSON.stringify({ transactional: raw, legacy, nativeRecord: stored });
      });
    } catch (error) {
      if (!(error instanceof NativeStorageRecoveryError)) throw error;
      return JSON.stringify({ encrypted: await exportNativeCiphertext(key), legacy,
        warning: 'Ciphertext cannot be decrypted without the original device key. The database has not been reset.' });
    }
  }),
  repair: (key, entries) => serializeNativeStorage(key, async () => {
    const legacy = await AsyncStorage.getItem(key);
    const backupKey = `${key}::corrupt-backup::${Crypto.randomUUID()}`;
    let written = 0, alreadyHandled = 0;
    await withNativeDatabase(key, async db => {
      const stored = await readNativeValue(db);
      // Untrustworthy tombstones cannot safely distinguish a new expense from
      // one already applied. Preserve everything and require manual recovery.
      let retired: Record<string, number> = {};
      if (stored !== null) {
        const row = JSON.parse(stored) as Row;
        if (!row.retired || typeof row.retired !== 'object' || Array.isArray(row.retired)
          || !Object.values(row.retired).every(Number.isFinite)) throw new Error('Expense history cannot be verified. Keep the recovery copy.');
        retired = row.retired;
      }
      const keep = entries.filter(entry => !Object.prototype.hasOwnProperty.call(retired, entry.id));
      const raw = JSON.stringify(keep); bounded(raw);
      await writeNativeValue(db, JSON.stringify({ stored, legacy }), backupKey);
      await writeNativeValue(db, JSON.stringify({ raw, retired } satisfies Row));
      written = keep.length; alreadyHandled = entries.length - keep.length;
    });
    if (legacy !== null) await AsyncStorage.removeItem(key).catch(() => undefined);
    emit(key);
    return { backupKey, written, alreadyHandled };
  }),
  subscribe: (key, changed) => {
    const callbacks = listeners.get(key) ?? new Set(); callbacks.add(changed); listeners.set(key, callbacks);
    return () => { callbacks.delete(changed); if (!callbacks.size) listeners.delete(key); };
  },
};
