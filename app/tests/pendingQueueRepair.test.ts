import { salvagePendingQueue, salvageRecoveryData, mergeSalvage, readRecoveryFile } from '../utils/pendingQueueRepair';
import { isReplayablePendingExpense } from '../utils/pendingExpenses';

const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'createExpense', args: { operationKey: `key-${id}` }, enqueuedAtMs: 10, attempts: 0, ...extra });
const envelope = (raw: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ schemaVersion: 1, kind: 'pending-expense-recovery', ownerId: 'owner-a', environment: 'https://api.test', raw, ...over });
const exportedFile = (env: string) => `Saved expense queue recovery\n"${env.replace(/"/g, '""')}"`;

describe('salvagePendingQueue', () => {
  it('keeps valid entries and counts the ones it cannot trust, never changing their keys', () => {
    const out = salvagePendingQueue(JSON.stringify([entry('a'), { id: 5 }, null, entry('a'), entry('b', { status: 'failed' }), entry('c', { attempts: 'x' })]));
    expect(out.entries.map(e => e.id)).toEqual(['a', 'b']);
    expect(out.entries[0].args).toEqual({ operationKey: 'key-a' });
    expect(out.skipped).toBe(4);
    expect(out.unreadable).toBe(false);
  });
  it('reports unreadable input instead of pretending it is empty', () => {
    expect(salvagePendingQueue('{damaged-data').unreadable).toBe(true);
    expect(salvagePendingQueue('{"not":"a list"}').unreadable).toBe(true);
    expect(salvagePendingQueue(null)).toEqual({ entries: [], skipped: 0, unreadable: false });
  });
});

describe('salvageRecoveryData / mergeSalvage', () => {
  it('reads the browser wrapper and de-duplicates across both copies, oldest first', () => {
    const wrapper = JSON.stringify({ transactional: JSON.stringify([entry('b', { enqueuedAtMs: 20 }), entry('a')]), legacy: JSON.stringify([entry('a'), entry('c', { enqueuedAtMs: 5 })]) });
    expect(salvageRecoveryData(wrapper).entries.map(e => e.id)).toEqual(['c', 'a', 'b']);
  });
  it('treats a wrapper whose parts are both unreadable as unreadable', () => {
    expect(salvageRecoveryData(JSON.stringify({ transactional: '{x', legacy: null })).entries).toEqual([]);
    expect(mergeSalvage([salvagePendingQueue('{x'), salvagePendingQueue('[')]).unreadable).toBe(true);
  });
});

describe('readRecoveryFile', () => {
  const raw = JSON.stringify([entry('a')]);
  it('reads the exact file the export writes, including quotes inside the data', () => {
    const tricky = JSON.stringify([entry('a', { lastError: 'He said "no"' })]);
    expect(readRecoveryFile(exportedFile(envelope(tricky)), 'owner-a', 'https://api.test')).toEqual({ ok: true, raw: tricky });
  });
  it('accepts the bare envelope too', () => {
    expect(readRecoveryFile(envelope(raw), 'owner-a', 'https://api.test')).toEqual({ ok: true, raw });
  });
  it('refuses another account, another server, and anything that is not a recovery file', () => {
    expect(readRecoveryFile(exportedFile(envelope(raw)), 'owner-b', 'https://api.test')).toEqual({ ok: false, reason: 'wrong-account' });
    expect(readRecoveryFile(exportedFile(envelope(raw)), 'owner-a', 'https://other.test')).toEqual({ ok: false, reason: 'wrong-environment' });
    expect(readRecoveryFile('hello', 'owner-a', 'https://api.test')).toEqual({ ok: false, reason: 'unrecognized' });
    expect(readRecoveryFile(exportedFile(envelope(raw, { kind: 'something-else' })), 'owner-a', 'https://api.test')).toEqual({ ok: false, reason: 'unrecognized' });
  });
});

describe('isReplayablePendingExpense', () => {
  const good = { kind: 'createExpense', args: { operationKey: 'k', payload: { tripId: 't', expenseDate: '2026-01-01', category: 'Food', amount: 4, currency: 'USD', payerIds: ['u'], forIds: ['u'] } } };
  it('accepts a complete expense and rejects anything the app could not replay', () => {
    expect(isReplayablePendingExpense(good)).toBe(true);
    expect(isReplayablePendingExpense({ ...good, kind: 'other' })).toBe(false);
    expect(isReplayablePendingExpense({ ...good, args: { ...good.args, operationKey: '' } })).toBe(false);
    expect(isReplayablePendingExpense({ ...good, args: { ...good.args, payload: { ...good.args.payload, amount: 'x' } } })).toBe(false);
    expect(isReplayablePendingExpense({ ...good, args: { ...good.args, payload: { ...good.args.payload, payerIds: [1] } } })).toBe(false);
    expect(isReplayablePendingExpense({ kind: 'createExpense' })).toBe(false);
  });
});
