import { rollUpTotals } from './coveredBy';

export interface PaymentRecord {
  payerId: string;
  receiverId: string;
  amountCents: number;
}

export interface SettlementParticipant {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  userEmail?: string | null;
}

export interface SettlementMatrix {
  sortedIds: string[];
  matrixCents: Record<string, Record<string, number>>;
  rowTotalsCents: Record<string, number>;
  columnTotalsCents: Record<string, number>;
  grandTotalCents: number;
}

export const toCents = (amount: number | string | null | undefined): number => {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

export const fromCents = (cents: number): number => Math.round(cents) / 100;

const sortKey = (p: SettlementParticipant): string => {
  const last = String(p.lastName ?? '').trim().toLowerCase();
  const first = String(p.firstName ?? '').trim().toLowerCase();
  const email = String(p.email ?? p.userEmail ?? '').trim().toLowerCase();
  return `${last}${first}${email}`;
};

export const sortParticipantIds = <T extends SettlementParticipant>(participants: T[]): string[] => {
  return [...participants]
    .sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return 0;
    })
    .map((p) => p.id);
};

export const resolveCoveringChain = (id: string, coveredBy: Record<string, string>): string => {
  let current = id;
  const seen = new Set<string>();
  while (coveredBy[current] && !seen.has(current)) {
    seen.add(current);
    current = coveredBy[current];
  }
  return current;
};

export const rollUpPayments = (
  payments: PaymentRecord[],
  coveredBy: Record<string, string>
): PaymentRecord[] => {
  const result: PaymentRecord[] = [];
  for (const p of payments) {
    const payerId = resolveCoveringChain(p.payerId, coveredBy);
    const receiverId = resolveCoveringChain(p.receiverId, coveredBy);
    if (payerId === receiverId) continue;
    result.push({ payerId, receiverId, amountCents: p.amountCents });
  }
  return result;
};

export const computeNetBalancesCents = (
  participantIds: string[],
  paidCents: Record<string, number>,
  usedCents: Record<string, number>,
  payments: PaymentRecord[]
): Record<string, number> => {
  const net: Record<string, number> = {};
  participantIds.forEach((id) => {
    net[id] = (paidCents[id] ?? 0) - (usedCents[id] ?? 0);
  });
  for (const p of payments) {
    if (net[p.payerId] !== undefined) net[p.payerId] += p.amountCents;
    if (net[p.receiverId] !== undefined) net[p.receiverId] -= p.amountCents;
  }
  return net;
};

export const computeSettlementMatrixCents = (
  sortedIds: string[],
  netBalancesCents: Record<string, number>
): SettlementMatrix => {
  const matrixCents: Record<string, Record<string, number>> = {};
  sortedIds.forEach((id) => {
    matrixCents[id] = {};
    sortedIds.forEach((jid) => {
      matrixCents[id][jid] = 0;
    });
  });

  const balances: Record<string, number> = {};
  sortedIds.forEach((id) => {
    balances[id] = netBalancesCents[id] ?? 0;
  });

  const pickMostNegative = (): string | null => {
    let best: string | null = null;
    let bestVal = 0;
    for (const id of sortedIds) {
      const v = balances[id];
      if (v < 0 && (best === null || v < bestVal)) {
        best = id;
        bestVal = v;
      }
    }
    return best;
  };

  const pickMostPositive = (): string | null => {
    let best: string | null = null;
    let bestVal = 0;
    for (const id of sortedIds) {
      const v = balances[id];
      if (v > 0 && (best === null || v > bestVal)) {
        best = id;
        bestVal = v;
      }
    }
    return best;
  };

  let safety = sortedIds.length * sortedIds.length + 4;
  while (safety-- > 0) {
    const debtor = pickMostNegative();
    const creditor = pickMostPositive();
    if (!debtor || !creditor) break;
    const owe = -balances[debtor];
    const owed = balances[creditor];
    const pay = Math.min(owe, owed);
    if (pay <= 0) break;
    matrixCents[debtor][creditor] += pay;
    balances[debtor] += pay;
    balances[creditor] -= pay;
  }

  const rowTotalsCents: Record<string, number> = {};
  const columnTotalsCents: Record<string, number> = {};
  sortedIds.forEach((id) => {
    rowTotalsCents[id] = 0;
    columnTotalsCents[id] = 0;
  });
  let grandTotalCents = 0;
  sortedIds.forEach((fromId) => {
    sortedIds.forEach((toId) => {
      const v = matrixCents[fromId][toId];
      rowTotalsCents[fromId] += v;
      columnTotalsCents[toId] += v;
      grandTotalCents += v;
    });
  });

  return { sortedIds, matrixCents, rowTotalsCents, columnTotalsCents, grandTotalCents };
};

export interface BuildSettlementOptions {
  participants: SettlementParticipant[];
  paidTotalsCents: Record<string, number>;
  usedTotalsCents: Record<string, number>;
  payments: PaymentRecord[];
  coveredBy: Record<string, string>;
}

export const buildSettlementMatrix = (opts: BuildSettlementOptions): SettlementMatrix => {
  const { participants, paidTotalsCents, usedTotalsCents, payments, coveredBy } = opts;
  const reportableParticipants = participants.filter((p) => !coveredBy[p.id]);
  const sortedIds = sortParticipantIds(reportableParticipants);

  const rolledPaid = rollUpTotals(paidTotalsCents, coveredBy);
  const rolledUsed = rollUpTotals(usedTotalsCents, coveredBy);
  const rolledPayments = rollUpPayments(payments, coveredBy);

  const net = computeNetBalancesCents(sortedIds, rolledPaid, rolledUsed, rolledPayments);
  return computeSettlementMatrixCents(sortedIds, net);
};

export const formatCents = (cents: number, currency: string = 'USD'): string => {
  const dollars = fromCents(cents);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(dollars);
};
