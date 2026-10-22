/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePendingWrites } from '../hooks/usePendingWrites';

const good = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'expense', args: { operationKey: `key-${id}` }, enqueuedAtMs: 1, attempts: 0, ...extra });

const fakeStore = (overrides: Record<string, unknown>) => ({
  read: jest.fn(), update: jest.fn(), claim: jest.fn(), renew: jest.fn(), release: jest.fn(),
  recovery: jest.fn(), repair: jest.fn(), subscribe: jest.fn(() => () => undefined), ...overrides,
}) as any;

describe('repairing an unreadable queue', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps what is readable under its original keys, backs up the original, and clears the error', async () => {
    const damaged = JSON.stringify([good('a'), { id: 7 }, good('b')]);
    window.localStorage.setItem('fix-me', damaged);
    const { result } = renderHook(() => usePendingWrites({ storageKey: 'fix-me', maxAttempts: null }));
    await waitFor(() => expect(result.current.storageError).toMatch(/kept for recovery/));
    let outcome: any;
    await act(async () => { outcome = await result.current.repairQueue([], () => true); });
    expect(outcome).toMatchObject({ status: 'repaired', restored: 2, skipped: 1 });
    expect(result.current.storageError).toBeNull();
    expect(result.current.pending.map(e => e.id)).toEqual(['a', 'b']);
    expect(JSON.parse(window.localStorage.getItem('fix-me')!).map((e: any) => e.args.operationKey)).toEqual(['key-a', 'key-b']);
    expect(window.localStorage.getItem(outcome.backupKey)).toBe(damaged);
  });

  it('changes nothing when nothing is recoverable', async () => {
    window.localStorage.setItem('hopeless', '{damaged-data');
    const { result } = renderHook(() => usePendingWrites({ storageKey: 'hopeless' }));
    await waitFor(() => expect(result.current.storageError).toBeTruthy());
    let outcome: any;
    await act(async () => { outcome = await result.current.repairQueue([], () => true); });
    expect(outcome.status).toBe('nothing-recoverable');
    expect(window.localStorage.getItem('hopeless')).toBe('{damaged-data');
    expect(result.current.storageError).toBeTruthy();
  });

  it('merges a recovery file, drops entries the caller cannot replay, and never touches another account', async () => {
    window.localStorage.setItem('mine', '{damaged-data');
    window.localStorage.setItem('theirs', JSON.stringify([good('theirs-only')]));
    const { result } = renderHook(() => usePendingWrites({ storageKey: 'mine' }));
    await waitFor(() => expect(result.current.storageError).toBeTruthy());
    const fromFile = JSON.stringify([good('a'), good('skip-me', { kind: 'unknown' })]);
    let outcome: any;
    await act(async () => { outcome = await result.current.repairQueue([fromFile], e => e.kind === 'expense'); });
    expect(outcome).toMatchObject({ status: 'repaired', restored: 1, skipped: 1 });
    expect(result.current.pending.map(e => e.id)).toEqual(['a']);
    expect(JSON.parse(window.localStorage.getItem('theirs')!)).toHaveLength(1);
  });

  it('uses the transactional store and reports ids that were already handled', async () => {
    let healthy = false;
    const store = fakeStore({
      read: jest.fn(async () => { if (!healthy) throw new Error('Unreadable saved queue; keep it for recovery'); return [good('a')]; }),
      recovery: jest.fn(async () => JSON.stringify({ transactional: '{broken', legacy: JSON.stringify([good('a'), good('done')]) })),
      repair: jest.fn(async (_key: string, entries: unknown[]) => { healthy = true; return { backupKey: 'backup-1', written: entries.length - 1, alreadyHandled: 1 }; }),
    });
    const { result } = renderHook(() => usePendingWrites({ storageKey: 'stp.pending-expenses.v1.x.y', store }));
    await waitFor(() => expect(result.current.storageError).toBeTruthy());
    let outcome: any;
    await act(async () => { outcome = await result.current.repairQueue([], () => true); });
    expect(store.repair).toHaveBeenCalledWith('stp.pending-expenses.v1.x.y', expect.arrayContaining([expect.objectContaining({ id: 'a' })]));
    expect(outcome).toMatchObject({ status: 'repaired', restored: 1, alreadyHandled: 1, backupKey: 'backup-1' });
    expect(result.current.storageError).toBeNull();
    expect(result.current.pending.map(e => e.id)).toEqual(['a']);
  });

  it('reports failure and leaves the state alone when the store cannot repair', async () => {
    const store = fakeStore({
      read: jest.fn(async () => { throw new Error('Unreadable saved queue; keep it for recovery'); }),
      recovery: jest.fn(async () => JSON.stringify({ transactional: JSON.stringify([good('a')]), legacy: null })),
      repair: jest.fn(async () => { throw new Error('The backup could not be saved, so nothing was changed.'); }),
    });
    const { result } = renderHook(() => usePendingWrites({ storageKey: 'stp.pending-expenses.v1.x.z', store }));
    await waitFor(() => expect(result.current.storageError).toBeTruthy());
    let outcome: any;
    await act(async () => { outcome = await result.current.repairQueue([], () => true); });
    expect(outcome).toEqual({ status: 'failed' });
    expect(result.current.storageError).toBeTruthy();
  });
});
