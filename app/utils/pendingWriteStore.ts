import type { PendingWrite } from '../hooks/usePendingWrites';

export interface PendingWriteStore {
  read(key: string): Promise<PendingWrite[]>;
  update(key: string, change: (entries: PendingWrite[]) => PendingWrite[], leaseToken?: string): Promise<PendingWrite[]>;
  claim(key: string, token: string, leaseMs: number): Promise<boolean>;
  renew(key: string, token: string, leaseMs: number): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
  recovery(key: string): Promise<string | null>;
  subscribe(key: string, changed: () => void): () => void;
}

// Native keeps its current storage path until the encrypted-store migration.
export const transactionalPendingWriteStore: PendingWriteStore | null = null;
