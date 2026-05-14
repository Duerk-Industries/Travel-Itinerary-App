import { parseReceiptText } from '../src/services/receiptExpenseParser';
import { getFeatureFlag } from '../src/db';

jest.mock('../src/db', () => ({
  getFeatureFlag: jest.fn(),
}));

describe('receipt expense parser', () => {
  beforeEach(() => {
    (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: false });
  });

  it('extracts a reviewable expense draft from receipt text', async () => {
    const parsed = await parseReceiptText(
      [
        'Flour Bakery',
        'Boston MA',
        'Date: 05/15/2026',
        'Subtotal $16.50',
        'Tax $1.02',
        'Total $17.52',
      ].join('\n'),
      { fallbackCurrency: 'USD', destination: 'Boston' }
    );

    expect(parsed).toEqual(expect.objectContaining({
      expenseDate: '2026-05-15',
      amount: 17.52,
      currency: 'USD',
      vendor: 'Flour Bakery',
      category: 'Breakfast',
      notes: 'Parsed from receipt photo. Review before saving.',
    }));
    expect(parsed.confidence).toBeGreaterThan(0.6);
  });

  it('uses charged total instead of total savings on grocery receipts', async () => {
    const parsed = await parseReceiptText(
      [
        'WHOLE FOODS MARKET',
        'Shrewsbury MA',
        'OG EASTER EGG RADISH $2.49',
        'Subtotal $106.96',
        'Sales Tax $4.90',
        'Net Sales $102.86',
        'Total: $102.86',
        'Paid: $102.86',
        'Your Total Savings $4.10',
        '205 12342 07/14/2025 03:09 PM',
      ].join('\n'),
      { fallbackCurrency: 'USD', destination: 'Boston' }
    );

    expect(parsed).toEqual(expect.objectContaining({
      expenseDate: '2025-07-14',
      amount: 102.86,
      currency: 'USD',
      vendor: 'Whole Foods Market',
      category: 'Other Food',
    }));
    expect(parsed.confidence).toBeGreaterThan(0.8);
  });
});
