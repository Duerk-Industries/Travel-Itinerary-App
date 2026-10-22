import type { PendingWrite } from '../hooks/usePendingWrites';

// Repair for an unreadable saved-expense queue (gap-closing plan §5.3).
//
// Principles: never lose the original (callers back it up before replacing anything), never
// invent or alter an operation key (entries keep their ids and args, so a replay is still
// deduplicated by the server's Idempotency-Key), and never accept another account's or
// environment's data.

export type Salvage = {
  entries: PendingWrite[];
  /** Entries that were present but could not be trusted (wrong shape, repeated id). */
  skipped: number;
  /** The input was not a JSON list at all, so nothing could be read from it. */
  unreadable: boolean;
};

const isEntry = (value: unknown): value is PendingWrite => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 200
    && typeof entry.kind === 'string' && entry.kind.length > 0
    && Number.isFinite(entry.enqueuedAtMs) && Number.isFinite(entry.attempts)
    && (entry.status === undefined || entry.status === 'pending' || entry.status === 'failed');
};

/** Keeps every entry that individually validates; the first of a repeated id wins. */
export const salvagePendingQueue = (raw: string | null | undefined): Salvage => {
  if (!raw) return { entries: [], skipped: 0, unreadable: false };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { entries: [], skipped: 0, unreadable: true }; }
  if (!Array.isArray(parsed)) return { entries: [], skipped: 0, unreadable: true };
  const seen = new Set<string>();
  const entries: PendingWrite[] = [];
  let skipped = 0;
  for (const candidate of parsed) {
    if (!isEntry(candidate) || seen.has(candidate.id)) { skipped += 1; continue; }
    seen.add(candidate.id);
    entries.push(candidate);
  }
  return { entries, skipped, unreadable: false };
};

/** Recovery data from the browser store is `{ transactional, legacy }`; native data is the queue itself. */
export const salvageRecoveryData = (recovery: string | null | undefined): Salvage => {
  if (!recovery) return { entries: [], skipped: 0, unreadable: false };
  let wrapper: unknown;
  try { wrapper = JSON.parse(recovery); } catch { return { entries: [], skipped: 0, unreadable: true }; }
  if (Array.isArray(wrapper)) return salvagePendingQueue(recovery);
  if (wrapper && typeof wrapper === 'object' && ('transactional' in wrapper || 'legacy' in wrapper)) {
    const { transactional, legacy } = wrapper as { transactional?: string | null; legacy?: string | null };
    return mergeSalvage([salvagePendingQueue(transactional), salvagePendingQueue(legacy)]);
  }
  return { entries: [], skipped: 0, unreadable: true };
};

export const mergeSalvage = (parts: Salvage[]): Salvage => {
  const seen = new Set<string>();
  const entries: PendingWrite[] = [];
  let skipped = 0;
  for (const part of parts) {
    skipped += part.skipped;
    for (const entry of part.entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id); entries.push(entry);
    }
  }
  entries.sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs || a.id.localeCompare(b.id));
  return { entries, skipped, unreadable: parts.length > 0 && parts.every(part => part.unreadable) };
};

export type RecoveryFileResult = { ok: true; raw: string } | { ok: false; reason: 'unrecognized' | 'wrong-account' | 'wrong-environment' };

/** Reads the file written by "Export saved expense recovery data": a title line, then the envelope in one quoted CSV cell. */
export const readRecoveryFile = (text: string, ownerId: string, environment: string): RecoveryFileResult => {
  const body = text.replace(/^﻿/, '').trim();
  const candidates: string[] = [];
  const newline = body.indexOf('\n');
  if (newline >= 0) {
    const cell = body.slice(newline + 1).trim();
    if (cell.startsWith('"') && cell.endsWith('"') && cell.length >= 2) candidates.push(cell.slice(1, -1).replace(/""/g, '"'));
    candidates.push(cell);
  }
  candidates.push(body);
  for (const candidate of candidates) {
    let envelope: unknown;
    try { envelope = JSON.parse(candidate); } catch { continue; }
    if (!envelope || typeof envelope !== 'object') continue;
    const value = envelope as Record<string, unknown>;
    if (value.kind !== 'pending-expense-recovery' || value.schemaVersion !== 1 || typeof value.raw !== 'string') continue;
    if (value.ownerId !== ownerId) return { ok: false, reason: 'wrong-account' };
    if (value.environment !== environment) return { ok: false, reason: 'wrong-environment' };
    return { ok: true, raw: value.raw };
  }
  return { ok: false, reason: 'unrecognized' };
};
