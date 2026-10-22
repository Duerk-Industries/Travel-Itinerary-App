import type { ApiSpendReservation } from '../types';
export const validateSpendBatch = (requests: ApiSpendReservation[]) => {
  if (!requests.length || requests.length > 192 || new Set(requests.map(row => row.id)).size !== requests.length) throw new Error('Invalid spend reservation batch');
  for (const row of requests) if (!/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || !/^[A-Z0-9_]{1,160}$/.test(row.provider) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.windowKey)
    || !Number.isSafeInteger(row.amountMicros) || row.amountMicros < 0 || row.limitMicros !== null && (!Number.isSafeInteger(row.limitMicros) || row.limitMicros < 0)) throw new Error('Invalid spend reservation');
};
export const validateActualSpend = (amount: number|null) => { if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw new Error('Invalid actual spend'); };
