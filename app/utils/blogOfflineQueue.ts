import { readAsync, removeAsync, writeAsync } from './persistentStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { canAccessWebStorage } from './persistentStorage';

export type OfflineBlogEntry = {
  id: string;
  accountId: string;
  tripId: string;
  dayDate: string;
  body: string;
  createdAt: string;
  attempts: number;
};

const PREFIX = 'wanderbunnies.blog-offline.v1';
const keyFor = (accountId: string, tripId: string): string => `${PREFIX}:${accountId}:${tripId}`;
const validDate = (value: unknown): value is string => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));

const parse = (raw: string | null, now: number, retentionDays: number): OfflineBlogEntry[] => {
  try {
    const rows = JSON.parse(raw ?? '[]');
    if (!Array.isArray(rows)) return [];
    const cutoff = now - retentionDays * 86_400_000;
    return rows.filter((row) => row && typeof row.id === 'string' && typeof row.accountId === 'string' && typeof row.tripId === 'string' && validDate(row.dayDate) && typeof row.body === 'string' && Date.parse(row.createdAt) >= cutoff);
  } catch {
    return [];
  }
};

export const listOfflineBlogEntries = async (accountId: string, tripId: string, retentionDays = 7): Promise<OfflineBlogEntry[]> =>
  parse(await readAsync(keyFor(accountId, tripId)), Date.now(), retentionDays);

export const enqueueOfflineBlogEntry = async (input: Omit<OfflineBlogEntry, 'id' | 'createdAt' | 'attempts'>, maxEntries = 25, retentionDays = 7): Promise<OfflineBlogEntry[]> => {
  if (!input.accountId || !input.tripId || !validDate(input.dayDate) || !input.body.trim() || input.body.length > 100_000) throw new Error('Invalid offline blog entry');
  const current = await listOfflineBlogEntries(input.accountId, input.tripId, retentionDays);
  if (current.length >= maxEntries) throw new Error(`Offline queue is full (${maxEntries} entries)`);
  const row: OfflineBlogEntry = { ...input, id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, createdAt: new Date().toISOString(), attempts: 0 };
  const next = [...current, row];
  await writeAsync(keyFor(input.accountId, input.tripId), JSON.stringify(next));
  return next;
};

export const flushOfflineBlogEntries = async (
  accountId: string,
  tripId: string,
  send: (entry: OfflineBlogEntry) => Promise<void>,
  retentionDays = 7
): Promise<{ remaining: OfflineBlogEntry[]; sent: number }> => {
  const queued = await listOfflineBlogEntries(accountId, tripId, retentionDays);
  const remaining: OfflineBlogEntry[] = [];
  let sent = 0;
  let networkBlocked = false;
  for (const row of queued) {
    if (networkBlocked) { remaining.push(row); continue; }
    try {
      await send(row);
      sent += 1;
    } catch {
      networkBlocked = true;
      remaining.push({ ...row, attempts: row.attempts + 1 });
    }
  }
  if (remaining.length) await writeAsync(keyFor(accountId, tripId), JSON.stringify(remaining));
  else await removeAsync(keyFor(accountId, tripId));
  return { remaining, sent };
};

export const clearOfflineBlogEntries = (accountId: string, tripId: string): Promise<void> => removeAsync(keyFor(accountId, tripId));

export const clearOfflineBlogAccount = async (accountId: string): Promise<void> => {
  if (!accountId) return;
  const prefix = `${PREFIX}:${accountId}:`;
  if (canAccessWebStorage()) {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
    return;
  }
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Logout must continue even if device storage is unavailable.
  }
};
