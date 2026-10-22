/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import {
  PENDING_EXPENSE_KIND,
  backoffDelayMs,
  buildPendingExpenseRow,
  classifyExpenseResponse,
  newPendingExpenseArgs,
  pendingExpensesStorageKey,
  sendPendingExpense,
} from '../utils/pendingExpenses';

const payload = {
  tripId: 'trip-1',
  expenseDate: '2026-11-12',
  category: 'Dinner',
  amount: 42.5,
  currency: 'USD',
  payerIds: ['m1'],
  forIds: ['m1', 'm2'],
  vendor: 'Ramen Shop',
};

const response = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

describe('pending expense helpers', () => {
  it('creates a server-acceptable operation key that is unique per expense', () => {
    const a = newPendingExpenseArgs(payload);
    const b = newPendingExpenseArgs(payload);
    expect(a.operationKey).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(a.operationKey).not.toBe(b.operationKey);
    expect(PENDING_EXPENSE_KIND).toBe('createExpense');
  });

  it('scopes the queue storage key to the account and backend', () => {
    const mine = pendingExpensesStorageKey('user-a', 'https://api.example.com');
    expect(mine).not.toBe(pendingExpensesStorageKey('user-b', 'https://api.example.com'));
    expect(mine).not.toBe(pendingExpensesStorageKey('user-a', 'https://staging.example.com'));
    expect(mine).not.toContain('/');
  });

  describe('classifyExpenseResponse', () => {
    it('treats any 2xx (including a replay of an already-saved expense) as done', () => {
      expect(classifyExpenseResponse(201, { id: 'e1' })).toEqual({ outcome: 'done', expense: { id: 'e1' } });
    });

    it('pauses on 401 instead of spending an attempt', () => {
      expect(classifyExpenseResponse(401, {}).outcome).toBe('pause');
    });

    it.each([408, 425, 429, 500, 502, 503])('retries transient status %i', (status) => {
      expect(classifyExpenseResponse(status, {}).outcome).toBe('retry');
    });

    it('surfaces a plain-language reason for permanent failures', () => {
      expect(classifyExpenseResponse(403, { error: 'You must be in the group for this trip' })).toEqual({
        outcome: 'failed',
        error: 'You no longer have access to this trip.',
      });
      const rejected = classifyExpenseResponse(400, { error: 'Invalid category' });
      expect(rejected).toEqual({ outcome: 'failed', error: 'Invalid category' });
      expect(classifyExpenseResponse(409, {}).outcome).toBe('failed');
    });
  });

  describe('backoffDelayMs', () => {
    it('grows with attempts and is capped at five minutes', () => {
      const noJitter = () => 1;
      expect(backoffDelayMs(0, noJitter)).toBe(5_000);
      expect(backoffDelayMs(2, noJitter)).toBe(20_000);
      expect(backoffDelayMs(30, noJitter)).toBe(300_000);
    });

    it('never returns less than half the nominal delay (jitter only spreads retries out)', () => {
      expect(backoffDelayMs(3, () => 0)).toBe(20_000);
    });
  });

  describe('sendPendingExpense', () => {
    const args = newPendingExpenseArgs(payload);
    const deps = (fetchImpl: typeof fetch) => ({ backendUrl: 'https://api.example.com', headers: { Authorization: 'Bearer t' }, fetchImpl });

    it('POSTs the payload with the stable Idempotency-Key and the auth header', async () => {
      const fetchImpl = jest.fn(async () => response(201, { id: 'e1' }));
      const result = await sendPendingExpense(args, deps(fetchImpl as unknown as typeof fetch));
      expect(result.outcome).toBe('done');
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.example.com/api/expenses');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(args.operationKey);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
      expect(JSON.parse(init.body as string)).toEqual(payload);
    });

    it('turns a network failure into a retry, never a loss', async () => {
      const fetchImpl = jest.fn(async () => {
        throw new TypeError('Network request failed');
      });
      const result = await sendPendingExpense(args, deps(fetchImpl as unknown as typeof fetch));
      expect(result.outcome).toBe('retry');
    });

    it('reuses the same key on every retry', async () => {
      const fetchImpl = jest.fn(async () => response(503));
      await sendPendingExpense(args, deps(fetchImpl as unknown as typeof fetch));
      await sendPendingExpense(args, deps(fetchImpl as unknown as typeof fetch));
      const keys = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).map(
        ([, init]) => (init.headers as Record<string, string>)['Idempotency-Key'],
      );
      expect(new Set(keys)).toEqual(new Set([args.operationKey]));
    });
  });

  it('builds a pending row that cannot be mistaken for a saved expense', () => {
    const row = buildPendingExpenseRow('entry-1', 'user-a', newPendingExpenseArgs(payload), 1_700_000_000_000);
    expect(row.id).toBe('pending:entry-1');
    expect(row.amount).toBe(42.5);
    expect(row.forIds).toEqual(['m1', 'm2']);
  });
});

describe('bounded expense HTTP lifetime', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it.each(['request', 'response body'])('returns a safe retry after 15 seconds with a stalled %s', async stalled => {
    const args = newPendingExpenseArgs(payload);
    let signal: AbortSignal | undefined;
    const send = jest.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return stalled === 'request' ? new Promise<Response>(() => undefined) : Promise.resolve({
        ok: true, status: 201, json: () => new Promise(() => undefined),
      } as unknown as Response);
    });
    let settled = false;
    const result = sendPendingExpense(args, { backendUrl: 'https://api.example.com', headers: {}, fetchImpl: send as unknown as typeof fetch });
    void result.then(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ outcome: 'retry' });
    expect(signal?.aborted).toBe(true);
    expect((send.mock.calls[0][1].headers as Record<string, string>)['Idempotency-Key']).toBe(args.operationKey);
    expect(jest.getTimerCount()).toBe(0);
  });
});
