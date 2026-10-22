import type { PendingWrite } from '../hooks/usePendingWrites';

export const parsePendingWriteQueue = (raw: string | null, strict = false): PendingWrite[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(entry => entry && typeof entry.id === 'string'
      && typeof entry.kind === 'string' && Number.isFinite(entry.enqueuedAtMs) && Number.isFinite(entry.attempts))) {
      throw new Error('Unreadable saved queue');
    }
    if (new Set(parsed.map(entry => entry.id)).size !== parsed.length) throw new Error('Duplicate queue identity');
    return parsed as PendingWrite[];
  } catch {
    if (strict) throw new Error('Unreadable saved queue; keep it for recovery');
    return [];
  }
};
