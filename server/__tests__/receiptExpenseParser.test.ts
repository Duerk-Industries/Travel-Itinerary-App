import { parseReceiptText } from '../src/services/receiptExpenseParser';

describe('receipt expense parser', () => {
  beforeEach(() => {
    process.env.MERCHANT_CATEGORY_LOOKUP_ENABLED = 'false';
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
      category: 'Other',
      notes: 'Parsed from receipt photo. Review before saving.',
    }));
    expect(parsed.confidence).toBeGreaterThan(0.6);
  });
});
