import { rollUpTotals } from './coveredBy';
import { singlePayerIds } from './payerSelection';
import { transferExpenseCategory } from './transferCategory';

import { carRentalExpenseDescription, flightExpenseDescription } from './expenseDescription';

const splitAmountIntoCents = (amount: number, parts: number): number[] => {
  if (!parts) return [];
  const cents = Math.round(amount * 100);
  const base = cents < 0 ? Math.ceil(cents / parts) : Math.floor(cents / parts);
  let remainder = cents - base * parts;

  return Array.from({ length: parts }, () => {
    const adjustment = remainder === 0 ? 0 : remainder > 0 ? 1 : -1;
    remainder -= adjustment;
    return (base + adjustment) / 100;
  });
};

/**
 * Splits an amount among people in proportion to their weights, to the cent. Whole cents are
 * handed out by largest remainder, so the parts always add back up to the amount. Equal weights
 * give the same split as splitAmountIntoCents.
 */
export const splitAmountByWeights = (amount: number, weights: number[]): number[] => {
  if (!weights.length) return [];
  const cents = Math.round(amount * 100);
  const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 1));
  const total = safe.reduce((sum, weight) => sum + weight, 0);
  const exact = safe.map((weight) => (cents * weight) / total);
  const parts = exact.map((value) => Math.trunc(value));
  let remaining = cents - parts.reduce((sum, part) => sum + part, 0);
  const direction = remaining >= 0 ? 1 : -1;
  const order = exact
    .map((value, index) => ({ index, fraction: Math.abs(value - Math.trunc(value)) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; remaining !== 0; i = (i + 1) % order.length) {
    parts[order[i].index] += direction;
    remaining -= direction;
  }
  return parts.map((part) => part / 100);
};

// (This would be moved from app/tabs/costReport.ts)
export const computePayerTotals = <T>(
  items: T[],
  getAmount: (item: T) => number,
  getPayers: (item: T) => string[],
  memberIds: string[] | undefined,
  options: {
    fallbackOnEmpty?: boolean;
    /** Per-person weights for an uneven split of an item; ignored when the people fall back to everyone. */
    getWeights?: (item: T) => Record<string, number> | null | undefined;
  } = {}
): Record<string, number> => {
  const safeMemberIds = Array.isArray(memberIds) ? memberIds : [];
  const totals: Record<string, number> = {};
  safeMemberIds.forEach((id) => {
    totals[id] = 0;
  });

  items.forEach((item) => {
    const amount = getAmount(item);
    if (!amount) return;

    let payers = (getPayers(item) ?? []).filter(Boolean);
    let weights = options.getWeights?.(item) ?? null;
    if (!payers.length && options.fallbackOnEmpty) {
      payers = safeMemberIds;
      weights = null;
    }
    if (!payers.length) return;

    const shares = weights ? splitAmountByWeights(amount, payers.map((id) => weights![id] ?? 1)) : splitAmountIntoCents(amount, payers.length);
    payers.forEach((payerId, index) => {
      if (totals[payerId] !== undefined) {
        totals[payerId] += shares[index] ?? 0;
      }
    });
  });

  // Round to 2 decimal places to avoid floating point issues
  for (const id in totals) {
    totals[id] = Math.round(totals[id] * 100) / 100;
  }

  return totals;
};

// New unified expense structure
export interface UnifiedExpense {
  sourceType?: string;
  sourceId?: string;
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  payerIds: string[];
  forIds: string[];
  /** Weight per person in forIds for an uneven split; absent means an equal split. */
  forShares?: Record<string, number> | null;
}

// New function to build the single data structure
export const buildAllExpenses = (
  flights: any[],
  lodgings: any[],
  tours: any[],
  carRentals: any[],
  dailyExpenses: any[],
  tripCurrency: string,
  allMemberIds: string[],
  defaultPayerId?: string | null
): UnifiedExpense[] => {
  const resolvePayers = (ids?: readonly string[] | null) => singlePayerIds(ids, defaultPayerId ?? allMemberIds[0]);
  const allExpenses: UnifiedExpense[] = [];

  flights.forEach((f) => {
    const paidBy =
      (Array.isArray(f.paidBy) && f.paidBy.length ? f.paidBy : null) ??
      (Array.isArray(f.paid_by) && f.paid_by.length ? f.paid_by : null) ??
      [];
    const passengerIds =
      (Array.isArray(f.passengerIds) && f.passengerIds.length ? f.passengerIds : null) ??
      (Array.isArray(f.passenger_ids) && f.passenger_ids.length ? f.passenger_ids : null) ??
      [];
    allExpenses.push({
      id: `flight-${f.id}`,
      sourceType: 'flight',
      sourceId: f.id,
      date: f.departureDate ?? f.departure_date,
      category: transferExpenseCategory(f),
      description: flightExpenseDescription(f),
      amount: Number(f.cost) || 0,
      currency: tripCurrency,
      payerIds: resolvePayers(paidBy),
      forIds: passengerIds.length ? passengerIds : allMemberIds,
    });
  });

  lodgings.forEach((l) => {
    const paidBy =
      (Array.isArray(l.paidBy) && l.paidBy.length ? l.paidBy : null) ??
      (Array.isArray(l.paid_by) && l.paid_by.length ? l.paid_by : null) ??
      [];
    const travelerIds =
      (Array.isArray(l.travelerIds) && l.travelerIds.length ? l.travelerIds : null) ??
      (Array.isArray(l.traveler_ids) && l.traveler_ids.length ? l.traveler_ids : null) ??
      [];
    allExpenses.push({
      id: `lodging-${l.id}`,
      sourceType: 'lodging',
      sourceId: l.id,
      date: l.checkInDate ?? l.check_in_date,
      category: 'Lodging',
      description: l.name ?? '',
      amount: Number(l.totalCost ?? l.total_cost) || 0,
      currency: tripCurrency,
      payerIds: resolvePayers(paidBy),
      forIds: travelerIds.length ? travelerIds : allMemberIds,
    });
  });

  tours.forEach((t) => {
    const paidBy =
      (Array.isArray(t.paidBy) && t.paidBy.length ? t.paidBy : null) ??
      (Array.isArray(t.paid_by) && t.paid_by.length ? t.paid_by : null) ??
      [];
    const travelerIds =
      (Array.isArray(t.travelerIds) && t.travelerIds.length ? t.travelerIds : null) ??
      (Array.isArray(t.traveler_ids) && t.traveler_ids.length ? t.traveler_ids : null) ??
      [];
    allExpenses.push({
      id: `tour-${t.id}`,
      sourceType: 'activity',
      sourceId: t.id,
      date: t.date,
      category: 'Activities',
      description: t.name ?? '',
      amount: Number(t.cost) || 0,
      currency: tripCurrency,
      payerIds: resolvePayers(paidBy),
      forIds: travelerIds.length ? travelerIds : paidBy.length ? paidBy : allMemberIds,
    });
  });

  carRentals.forEach((c) => {
    const paidBy =
      (Array.isArray(c.paidBy) && c.paidBy.length ? c.paidBy : null) ??
      (Array.isArray(c.paid_by) && c.paid_by.length ? c.paid_by : null) ??
      [];
    const travelerIds =
      (Array.isArray(c.travelerIds) && c.travelerIds.length ? c.travelerIds : null) ??
      (Array.isArray(c.traveler_ids) && c.traveler_ids.length ? c.traveler_ids : null) ??
      [];
    allExpenses.push({
      id: `car-${c.id}`,
      sourceType: 'car_rental',
      sourceId: c.id,
      date: c.pickupDate ?? c.pickup_date,
      category: 'Car Rentals',
      description: carRentalExpenseDescription(c),
      amount: Number(c.cost) || 0,
      currency: tripCurrency,
      payerIds: resolvePayers(paidBy),
      forIds: travelerIds.length ? travelerIds : allMemberIds,
    });
  });

  dailyExpenses
    .filter((e) => !e?.sourceType && !e?.source_type)
    .forEach((e) =>
      allExpenses.push({
        id: `expense-${e.id}`,
        date: e.expenseDate ?? e.expense_date,
        category: e.category,
        description: e.vendor || e.notes || '',
        amount: Number(e.amountInTripCurrency ?? e.amount) || 0,
        currency: tripCurrency,
        payerIds: resolvePayers(Array.isArray(e.payerIds) ? e.payerIds : Array.isArray(e.payer_ids) ? e.payer_ids : []),
        forIds: Array.isArray(e.forIds) && e.forIds.length > 0 ? e.forIds : allMemberIds,
        forShares: e.forShares ?? null,
      })
    );

  return allExpenses;
};

// New main calculation function
export const calculateAllTotals = (
  allExpenses: UnifiedExpense[],
  allMemberIds: string[],
  reportableMemberIds: string[],
  coveredBy: Record<string, string>
) => {
  const rawPaidTotals = computePayerTotals(allExpenses, e => e.amount, e => e.payerIds, allMemberIds, { fallbackOnEmpty: true });
  const rawUsedTotals = computePayerTotals(allExpenses, e => e.amount, e => e.forIds, allMemberIds, { fallbackOnEmpty: true, getWeights: e => e.forShares });

  const ledgerPaidTotals = rollUpTotals(rawPaidTotals, coveredBy);
  const ledgerUsedTotals = rollUpTotals(rawUsedTotals, coveredBy);

  const finalBalances: Record<string, number> = {};
  reportableMemberIds.forEach((id) => {
      const paid = ledgerPaidTotals[id] || 0;
      const used = ledgerUsedTotals[id] || 0;
      finalBalances[id] = paid - used;
  });

  return { ledgerPaidTotals, ledgerUsedTotals, finalBalances };
};
