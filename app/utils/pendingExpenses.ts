import { createIdempotencyKey } from './idempotencyKey';

/** Queue entry kind for an expense created while offline. */
export const PENDING_EXPENSE_KIND = 'createExpense';

export type PendingExpensePayload = {
  tripId: string;
  expenseDate: string;
  category: string;
  amount: number;
  currency: string;
  amountInTripCurrency?: number;
  exchangeRateToTripCurrency?: number;
  exchangeRateDate?: string;
  payerIds: string[];
  forIds: string[];
  vendor?: string;
};

export type PendingExpenseArgs = {
  /** Sent as the Idempotency-Key header. Stable across every retry of this one expense. */
  operationKey: string;
  payload: PendingExpensePayload;
};

export const newPendingExpenseArgs = (payload: PendingExpensePayload): PendingExpenseArgs => ({
  operationKey: createIdempotencyKey('exp'),
  payload,
});

/** Queue storage key scoped to one account on one backend, so another user on the same device can never see or replay it. */
export const pendingExpensesStorageKey = (userId: string, environment: string): string =>
  `stp.pending-expenses.v1.${encodeURIComponent(environment)}.${encodeURIComponent(userId)}`;

export type ReplayOutcome =
  | { outcome: 'done'; expense: Record<string, unknown> }
  | { outcome: 'retry'; error?: string }
  | { outcome: 'failed'; error: string }
  | { outcome: 'pause'; error: string };

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;

/** Exponential backoff with jitter; `random` is injectable for tests. */
export const backoffDelayMs = (attempts: number, random: () => number = Math.random): number => {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts));
  return Math.round(exp / 2 + random() * (exp / 2));
};

const FAILURE_COPY: Record<number, string> = {
  402: 'Expense tracking is not available on your plan.',
  403: 'You no longer have access to this trip.',
  404: 'This trip no longer exists.',
};

/**
 * Maps a server response to what the queue should do:
 *  - 2xx: saved (a replay of an already-saved operation also returns 2xx with the original expense)
 *  - 401: signed out/expired; pause without spending an attempt until the same account signs in again
 *  - 408/425/429/5xx: transient, retry with backoff
 *  - other 4xx (validation, access, key reuse): will not succeed on retry; surface to the user
 */
export const classifyExpenseResponse = (status: number, body: unknown): ReplayOutcome => {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (status >= 200 && status < 300) {
    return typeof record.id === 'string' && record.id.trim()
      ? { outcome: 'done', expense: record }
      : { outcome: 'retry', error: 'The server confirmation was incomplete. Your saved expense will be retried safely.' };
  }
  const serverMessage = typeof record.error === 'string' ? record.error : '';
  if (status === 401) return { outcome: 'pause', error: 'Sign in again to finish syncing.' };
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { outcome: 'retry', error: serverMessage || 'The server is busy. Will try again.' };
  }
  return { outcome: 'failed', error: FAILURE_COPY[status] || serverMessage || `The server rejected this expense (${status}).` };
};

/** Sends one queued expense. Never throws: a network failure is a retry, not a loss. */
export const sendPendingExpense = async (
  args: PendingExpenseArgs,
  deps: { backendUrl: string; headers: Record<string, string>; fetchImpl?: typeof fetch }
): Promise<ReplayOutcome> => {
  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReplayOutcome>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ outcome: 'retry', error: 'The request timed out. Your saved expense will be retried safely.' });
    }, 15_000);
  });
  try {
    const request = (async (): Promise<ReplayOutcome> => {
      const response = await doFetch(`${deps.backendUrl}/api/expenses`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...deps.headers, 'Idempotency-Key': args.operationKey },
        body: JSON.stringify(args.payload),
      });
      const body: unknown = await response.json().catch(() => null);
      const result = classifyExpenseResponse(response.status, body);
      if (result.outcome === 'done' && result.expense.tripId !== undefined && result.expense.tripId !== args.payload.tripId) {
        return { outcome: 'retry', error: 'The server confirmation did not match this trip. Your saved expense has been kept.' };
      }
      return result;
    })();
    return await Promise.race([request, timeout]);
  } catch {
    return { outcome: 'retry', error: 'No connection. Will try again.' };
  } finally { if (timer !== undefined) clearTimeout(timer); }

};

/** Local-only stand-in shown in the list until the server confirms. Never mixed into totals as if it were saved. */
export const buildPendingExpenseRow = (entryId: string, userId: string, args: PendingExpenseArgs, enqueuedAtMs: number) => ({
  id: `pending:${entryId}`,
  tripId: args.payload.tripId,
  groupId: '',
  userId,
  expenseDate: args.payload.expenseDate,
  category: args.payload.category,
  amount: args.payload.amount,
  currency: args.payload.currency,
  amountInTripCurrency: args.payload.amountInTripCurrency ?? null,
  exchangeRateToTripCurrency: args.payload.exchangeRateToTripCurrency ?? null,
  exchangeRateDate: args.payload.exchangeRateDate ?? null,
  vendor: args.payload.vendor ?? null,
  notes: null,
  payerIds: args.payload.payerIds,
  forIds: args.payload.forIds,
  createdAt: new Date(enqueuedAtMs).toISOString(),
  sourceType: null,
  sourceId: null,
});
