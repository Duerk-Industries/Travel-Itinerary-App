import { computePayerTotals } from './costs';

type Member = {
  id: string;
  firstName?: string;
  lastName?: string;
};

type Expense = {
  date: string;
  category: string;
  /** Linked item name (flights etc.) or the expense's own Description; may be empty. */
  description?: string;
  amount: number;
  payerIds: string[];
  forIds: string[];
  forShares?: Record<string, number> | null;
};

type CsvConversionOptions = {
  expenses: Expense[];
  members: Member[];
  formatMemberName: (member: Member) => string;
  coveredBy: Record<string, string>;
  expenseType: 'paid' | 'incurred';
};

const escapeCsvCell = (cell: any): string => {
  const cellStr = String(cell ?? '');
  if (/[",\n]/.test(cellStr)) {
    return `"${cellStr.replace(/"/g, '""')}"`;
  }
  return cellStr;
};

export const convertExpensesToCsv = (options: CsvConversionOptions): string => {
  const { expenses, members, formatMemberName, coveredBy, expenseType } = options;
  const memberIds = members.map((m) => m.id);

  const header = ['Date', 'Category', 'Description', ...members.map(formatMemberName)];
  const rows = expenses.map((expense) => {
    const row: (string | number)[] = [expense.date, expense.category, expense.description ?? ''];
    const ids = expenseType === 'paid' ? expense.payerIds : expense.forIds;
    const rolledUpIds = (ids || []).map((id) => coveredBy[id] || id);

    // An uneven split follows the money to whoever covers each person: weights of people rolled up
    // into the same covering member add together.
    let weightsByRolledUpId: Record<string, number> | null = null;
    if (expenseType === 'incurred' && expense.forShares && rolledUpIds.length) {
      weightsByRolledUpId = {};
      (ids || []).forEach((id, index) => {
        const rolled = rolledUpIds[index];
        weightsByRolledUpId![rolled] = (weightsByRolledUpId![rolled] ?? 0) + (expense.forShares?.[id] ?? 1);
      });
    }
    const splitIds = weightsByRolledUpId ? Object.keys(weightsByRolledUpId) : rolledUpIds;
    const totals = computePayerTotals([{ amount: expense.amount, ids: splitIds, weights: weightsByRolledUpId }], (item) => item.amount, (item) => item.ids, memberIds, { fallbackOnEmpty: true, getWeights: (item) => item.weights });

    memberIds.forEach((id) => {
      row.push(totals[id]?.toFixed(2) || '0.00');
    });
    return row.map(escapeCsvCell).join(',');
  });
  return [header.map(escapeCsvCell).join(','), ...rows].join('\n');
};