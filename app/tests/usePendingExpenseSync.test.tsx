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
