import { computePayerTotals } from './costs';

type Member = {
  id: string;
  firstName?: string;
  lastName?: string;
};

type Expense = {
  date: string;
  category: string;
  amount: number;
  payerIds: string[];
  forIds: string[];
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

  const header = ['Date', 'Category', ...members.map(formatMemberName)];
  const rows = expenses.map((expense) => {
    const row: (string | number)[] = [expense.date, expense.category];
    const ids = expenseType === 'paid' ? expense.payerIds : expense.forIds;
    const rolledUpIds = (ids || []).map((id) => coveredBy[id] || id);

    const totals = computePayerTotals([{ amount: expense.amount, ids: rolledUpIds }], (item) => item.amount, (item) => item.ids, memberIds, { fallbackOnEmpty: true });

    memberIds.forEach((id) => {
      row.push(totals[id]?.toFixed(2) || '0.00');
    });
    return row.map(escapeCsvCell).join(',');
  });
  return [header.map(escapeCsvCell).join(','), ...rows].join('\n');
};