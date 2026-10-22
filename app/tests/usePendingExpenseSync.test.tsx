/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { usePendingExpenseSync } from '../hooks/usePendingExpenseSync';
import { newPendingExpenseArgs } from '../utils/pendingExpenses';

const payload = {
  tripId: 'trip-1',
  expenseDate: '2026-11-12',
  category: 'Dinner',
  amount: 20,
  currency: 'USD',
  payerIds: ['m1'],
  forIds: ['m1'],
};

const reply = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

type Props = { userId: string | null; canSync: boolean; token?: string };

const setup = (initial: Props, onSynced = jest.fn()) => {
  const hook = renderHook(
    (props: Props) =>
      usePendingExpenseSync({
        userId: props.userId,
        backendUrl: 'https://api.example.com',
        headers: { Authorization: `Bearer ${props.token ?? 'tok'}` },
        canSync: props.canSync,
        onSynced,
      }),
    { initialProps: initial },
  );
  return { ...hook, onSynced };
};

describe('usePendingExpenseSync', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('holds an offline expense without sending, then syncs it once when the device comes back online', async () => {
    const fetchMock = jest.fn(async () => reply(201, { id: 'server-1', tripId: 'trip-1' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result, rerender, onSynced } = setup({ userId: 'u1', canSync: false });

    const args = newPendingExpenseArgs(payload);
    await act(async () => {
      expect(await result.current.queueExpense(args)).toBeTruthy();
    });
    expect(result.current.entries).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ userId: 'u1', canSync: true });
    await waitFor(() => expect(result.current.entries).toHaveLength(0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(args.operationKey);
    expect(onSynced).toHaveBeenCalledWith({ id: 'server-1', tripId: 'trip-1' }, 'trip-1');
    expect(result.current.syncedNotice).toBe('1 offline expense synced');
  });

  it('keeps the expense and marks it needing attention when the server says access was revoked', async () => {
    global.fetch = jest.fn(async () => reply(403, { error: 'You must be in the group for this trip' })) as unknown as typeof fetch;
    const { result } = setup({ userId: 'u1', canSync: true });
    await act(async () => {
      await result.current.queueExpense(newPendingExpenseArgs(payload));
    });
    await waitFor(() => expect(result.current.entries[0]?.status).toBe('failed'));
    expect(result.current.entries[0].lastError).toBe('You no longer have access to this trip.');
    expect(result.current.entries).toHaveLength(1);
  });

  it('keeps retrying later instead of dropping when the network is down mid-sync', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const { result } = setup({ userId: 'u1', canSync: true });
    await act(async () => {
      await result.current.queueExpense(newPendingExpenseArgs(payload));
    });
    await waitFor(() => expect(result.current.entries[0]?.attempts).toBe(1));
    expect(result.current.entries[0].status).not.toBe('failed');
    expect(result.current.entries[0].nextAttemptAtMs).toBeGreaterThan(Date.now());
  });

  it('pauses on 401 and does not hammer the server until the user signs in again', async () => {
    const fetchMock = jest.fn(async () => reply(401, {}));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result, rerender } = setup({ userId: 'u1', canSync: true, token: 'old' });
    await act(async () => {
      await result.current.queueExpense(newPendingExpenseArgs(payload));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.entries[0].attempts).toBe(0);

    rerender({ userId: 'u1', canSync: true, token: 'old' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () => reply(201, { id: 'server-2' }));
    rerender({ userId: 'u1', canSync: true, token: 'new' });
    await waitFor(() => expect(result.current.entries).toHaveLength(0));
  });

  it('does not queue anything when nobody is signed in, and never shows another account\'s expenses', async () => {
    const first = setup({ userId: 'u1', canSync: false });
    await act(async () => {
      await first.result.current.queueExpense(newPendingExpenseArgs(payload));
    });
    expect(first.result.current.entries).toHaveLength(1);

    const signedOut = setup({ userId: null, canSync: false });
    let queued: string | null = 'unset';
    await act(async () => {
      queued = await signedOut.result.current.queueExpense(newPendingExpenseArgs(payload));
    });
    expect(queued).toBeNull();

    const other = setup({ userId: 'u2', canSync: false });
    expect(other.result.current.entries).toHaveLength(0);
  });
});


it('retries a due expense on foreground resume with the same operation key and removes its listener', async () => {
  window.localStorage.clear();
  const originalFetch = global.fetch;
  const fetchMock = jest.fn(async () => { throw new TypeError('offline'); }) as jest.Mock<Promise<Response>>;
  global.fetch = fetchMock as unknown as typeof fetch;
  const { result, unmount } = setup({ userId: 'resume-owner', canSync: true });
  let clock: jest.SpyInstance | undefined;
  try {
    const args = newPendingExpenseArgs(payload);
    await act(async () => { await result.current.queueExpense(args); });
    await waitFor(() => expect(result.current.entries[0]?.attempts).toBe(1));
    const due = result.current.entries[0].nextAttemptAtMs!;
    clock = jest.spyOn(Date, 'now').mockReturnValue(due + 1);
    fetchMock.mockImplementation(async () => reply(201, { id: 'resumed', tripId: payload.tripId }));
    const mock = jest.mocked(AppState.addEventListener).mock;
    const listener = mock.calls[mock.calls.length - 1][1];
    const subscription = mock.results[mock.results.length - 1].value;
    act(() => listener('active'));
    await waitFor(() => expect(result.current.entries).toHaveLength(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(args.operationKey);
    }
    unmount();
    expect(subscription.remove).toHaveBeenCalled();
  } finally { clock?.mockRestore(); global.fetch = originalFetch; }
});

describe('expense replay lifecycle recovery', () => {
  const originalFetch = global.fetch;
  const emit = (state: 'active' | 'background' | 'inactive') => {
    const calls = jest.mocked(AppState.addEventListener).mock.calls;
    act(() => calls[calls.length - 1][1](state));
  };
  beforeEach(() => { window.localStorage.clear(); AppState.currentState = 'active'; });
  afterEach(() => { global.fetch = originalFetch; AppState.currentState = 'active'; jest.restoreAllMocks(); });

  it('does not start requests in the background and resumes when active', async () => {
    AppState.currentState = 'background';
    const send = jest.fn(async () => reply(201, { id: 'foreground' })); global.fetch = send;
    const hook = setup({ userId: 'background-owner', canSync: true });
    await act(async () => { await hook.result.current.queueExpense(newPendingExpenseArgs(payload)); });
    act(() => hook.result.current.syncNow());
    expect(send).not.toHaveBeenCalled(); expect(hook.result.current.entries).toHaveLength(1);
    emit('active');
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(0));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fences a response across a batched suspend/resume and wakes after the old drain unlocks', async () => {
    let resolve!: (response: Response) => void;
    const send = jest.fn(() => new Promise<Response>(done => { resolve = done; })); global.fetch = send;
    const hook = setup({ userId: 'suspend-owner', canSync: true });
    const args = newPendingExpenseArgs(payload);
    await act(async () => { await hook.result.current.queueExpense(args); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const calls = jest.mocked(AppState.addEventListener).mock.calls;
    const listener = calls[calls.length - 1][1];
    act(() => { listener('background'); listener('active'); });
    send.mockImplementation(async () => reply(200, { id: 'same-server-expense' }));
    await act(async () => { resolve(reply(201, { id: 'stale-response' })); });
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(0));
    expect(send).toHaveBeenCalledTimes(2);
    expect(hook.onSynced).toHaveBeenCalledTimes(1);
    expect(hook.onSynced).toHaveBeenCalledWith({ id: 'same-server-expense' }, payload.tripId);
    for (const call of send.mock.calls) expect(((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)['Idempotency-Key']).toBe(args.operationKey);
  });

  it('keeps an in-flight operation durable across unmount/relaunch and suppresses stale UI callbacks', async () => {
    let resolve!: (response: Response) => void;
    const send = jest.fn(() => new Promise<Response>(done => { resolve = done; })); global.fetch = send;
    const first = setup({ userId: 'relaunch-owner', canSync: true });
    const args = newPendingExpenseArgs(payload);
    await act(async () => { await first.result.current.queueExpense(args); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    first.unmount();
    await act(async () => { resolve(reply(201, { id: 'committed-before-kill' })); });
    expect(first.onSynced).not.toHaveBeenCalled();
    send.mockImplementation(async () => reply(200, { id: 'committed-before-kill' }));
    const next = setup({ userId: 'relaunch-owner', canSync: true });
    await waitFor(() => expect(next.result.current.entries).toHaveLength(0));
    expect(send).toHaveBeenCalledTimes(2);
    for (const call of send.mock.calls) expect(((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)['Idempotency-Key']).toBe(args.operationKey);
  });

  it('yields after a bounded batch and schedules the remaining work without waiting for another resume', async () => {
    const send = jest.fn(async () => reply(201, { id: 'synced' })); global.fetch = send;
    const hook = setup({ userId: 'batch-owner', canSync: false });
    await act(async () => {
      for (let n = 0; n < 25; n++) await hook.result.current.queueExpense(newPendingExpenseArgs(payload));
    });
    hook.rerender({ userId: 'batch-owner', canSync: true });
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(0));
    expect(send).toHaveBeenCalledTimes(25);
  });
});
