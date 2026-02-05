import { rollUpTotals } from './coveredBy';

// (This would be moved from app/tabs/costReport.ts)
export const computePayerTotals = <T>(
  items: T[],
  getAmount: (item: T) => number,
  getPayers: (item: T) => string[],
  memberIds: string[] | undefined,
  options: { fallbackOnEmpty?: boolean } = {}
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
    if (!payers.length && options.fallbackOnEmpty) {
      payers = safeMemberIds;
    }
    if (!payers.length) return;

    const share = amount / payers.length;

    payers.forEach((payerId, index) => {
      if (totals[payerId] !== undefined) {
        // Distribute remainder to the first payer to avoid floating point issues
        const amountToAdd = index === 0 ? amount - (share * (payers.length -1)) : share;
        totals[payerId] += amountToAdd;
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
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  payerIds: string[];
  forIds: string[];
}

// New function to build the single data structure
export const buildAllExpenses = (
  flights: any[],
  lodgings: any[],
  tours: any[],
  carRentals: any[],
  dailyExpenses: any[],
  tripCurrency: string,
  allMemberIds: string[]
): UnifiedExpense[] => {
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
      date: f.departureDate ?? f.departure_date,
      category: 'Flights',
      description: `${f.carrier ?? ''} ${f.flightNumber ?? f.flight_number ?? ''}`.trim(),
      amount: Number(f.cost) || 0,
      currency: tripCurrency,
      payerIds: paidBy.length ? paidBy : passengerIds.length ? passengerIds : allMemberIds,
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
      date: l.checkInDate ?? l.check_in_date,
      category: 'Lodging',
      description: l.name ?? '',
      amount: Number(l.totalCost ?? l.total_cost) || 0,
      currency: tripCurrency,
      payerIds: paidBy.length ? paidBy : allMemberIds,
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
      date: t.date,
      category: 'Tours',
      description: t.name ?? '',
      amount: Number(t.cost) || 0,
      currency: tripCurrency,
      payerIds: paidBy.length ? paidBy : allMemberIds,
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
      date: c.pickupDate ?? c.pickup_date,
      category: 'Car Rentals',
      description: c.vendor ?? c.model ?? '',
      amount: Number(c.cost) || 0,
      currency: tripCurrency,
      payerIds: paidBy.length ? paidBy : allMemberIds,
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
        description: e.notes || e.category,
        amount: Number(e.amountInTripCurrency ?? e.amount) || 0,
        currency: tripCurrency,
        payerIds: Array.isArray(e.payerIds) && e.payerIds.length > 0 ? e.payerIds : allMemberIds,
        forIds: Array.isArray(e.forIds) && e.forIds.length > 0 ? e.forIds : allMemberIds,
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
  const rawUsedTotals = computePayerTotals(allExpenses, e => e.amount, e => e.forIds, allMemberIds, { fallbackOnEmpty: true });

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
