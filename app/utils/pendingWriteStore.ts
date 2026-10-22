import type { PendingWrite } from '../hooks/usePendingWrites';

export interface PendingWriteStore {
  read(key: string): Promise<PendingWrite[]>;
  update(key: string, change: (entries: PendingWrite[]) => PendingWrite[], leaseToken?: string): Promise<PendingWrite[]>;
  claim(key: string, token: string, leaseMs: number): Promise<boolean>;
  renew(key: string, token: string, leaseMs: number): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
  recovery(key: string): Promise<string | null>;
  /** Replaces an unreadable queue with these entries after backing the original up. Skips ids already handled (synced or discarded). */
  repair?(key: string, entries: PendingWrite[]): Promise<{ backupKey: string; written: number; alreadyHandled: number }>;
  subscribe(key: string, changed: () => void): () => void;
}

// Platform overrides use IndexedDB on web and SQLCipher on native.
export const transactionalPendingWriteStore: PendingWriteStore | null = null;
