import { rollUpTotals } from './coveredBy';

// (This would be moved from app/tabs/costReport.ts)
export const computePayerTotals = <T>(
  items: T[],
  getAmount: (item: T) => number,
  getPayers: (item: T) => string[],
  memberIds: string[],
  options: { fallbackOnEmpty?: boolean } = {}
): Record<string, number> => {
  const totals: Record<string, number> = {};
  memberIds.forEach((id) => {
    totals[id] = 0;
  });

  items.forEach((item) => {
    const amount = getAmount(item);
    if (!amount) return;

    let payers = getPayers(item);
    if (!payers.length && options.fallbackOnEmpty) {
      payers = memberIds;
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

  flights.forEach(f => allExpenses.push({
      id: `flight-${f.id}`,
      date: f.departure_date,
      category: 'Flights',
      description: `${f.carrier} ${f.flight_number}`,
      amount: Number(f.cost) || 0,
      currency: tripCurrency,
      payerIds: Array.isArray(f.paidBy) && f.paidBy.length > 0 ? f.paidBy : (f.passenger_ids.length > 0 ? f.passenger_ids : allMemberIds),
      forIds: Array.isArray(f.passenger_ids) && f.passenger_ids.length > 0 ? f.passenger_ids : allMemberIds,
  }));

  lodgings.forEach(l => allExpenses.push({
      id: `lodging-${l.id}`,
      date: l.checkInDate,
      category: 'Lodging',
      description: l.name,
      amount: Number(l.totalCost) || 0,
      currency: tripCurrency,
      payerIds: Array.isArray(l.paidBy) && l.paidBy.length > 0 ? l.paidBy : allMemberIds,
      forIds: Array.isArray(l.travelerIds) && l.travelerIds.length > 0 ? l.travelerIds : allMemberIds,
  }));

  tours.forEach(t => allExpenses.push({
      id: `tour-${t.id}`,
      date: t.date,
      category: 'Tours',
      description: t.name,
      amount: Number(t.cost) || 0,
      currency: tripCurrency,
      payerIds: Array.isArray(t.paidBy) && t.paidBy.length > 0 ? t.paidBy : allMemberIds,
      forIds: Array.isArray(t.paidBy) && t.paidBy.length > 0 ? t.paidBy : allMemberIds,
  }));

  carRentals.forEach(c => allExpenses.push({
      id: `car-${c.id}`,
      date: c.pickupDate,
      category: 'Car Rentals',
      description: c.vendor || c.model,
      amount: Number(c.cost) || 0,
      currency: tripCurrency,
      payerIds: Array.isArray(c.paidBy) && c.paidBy.length > 0 ? c.paidBy : allMemberIds,
      forIds: Array.isArray(c.travelerIds) && c.travelerIds.length > 0 ? c.travelerIds : allMemberIds,
  }));

  dailyExpenses.forEach(e => allExpenses.push({
      id: `expense-${e.id}`,
      date: e.expenseDate,
      category: e.category,
      description: e.notes || e.category,
      amount: Number(e.amountInTripCurrency ?? e.amount) || 0,
      currency: tripCurrency,
      payerIds: Array.isArray(e.payerIds) && e.payerIds.length > 0 ? e.payerIds : allMemberIds,
      forIds: Array.isArray(e.forIds) && e.forIds.length > 0 ? e.forIds : allMemberIds,
  }));

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