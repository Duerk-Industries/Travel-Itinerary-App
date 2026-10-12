/// <reference types="jest" />
/// <reference types="node" />
import { extractCurrency, extractDate, extractTime, mealForTime, parseMoney, parseReceiptText, tidyVendorName } from '../src/services/receiptExpenseParser';
import { getFeatureFlag } from '../src/db';

jest.mock('../src/db', () => ({
  getFeatureFlag: jest.fn(),
}));

describe('receipt expense parser', () => {
  beforeEach(() => {
    (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: false });
  });

  it('extracts a reviewable expense draft from receipt text, with no boilerplate in the description', async () => {
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
      expenseTime: null,
      amount: 17.52,
      currency: 'USD',
      vendor: 'Flour Bakery',
      establishmentType: 'cafe',
      category: 'Breakfast', // a bakery with no time on the receipt keeps the old default
      notes: null,
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
      expenseTime: '15:09',
      amount: 102.86,
      currency: 'USD',
      vendor: 'Whole Foods Market',
      category: 'Other Food', // groceries are never a meal, whatever the time
    }));
    expect(parsed.confidence).toBeGreaterThan(0.8);
  });

  it('reads a European restaurant receipt: day-first date, decimal comma, lei, dinner by time', async () => {
    const parsed = await parseReceiptText(
      [
        'CARUL CU BERE',
        'Str. Stavropoleos 5, Bucuresti',
        'Data: 05.09.2026 Ora: 20:41',
        'Ciorba 18,50',
        'Bere 12,00',
        'TOTAL 45,50 LEI',
        'CARD',
      ].join('\n'),
      { fallbackCurrency: 'USD', destination: 'Bucharest', tripStartDate: '2026-09-05', tripEndDate: '2026-09-11' }
    );

    expect(parsed).toEqual(expect.objectContaining({
      expenseDate: '2026-09-05',
      expenseTime: '20:41',
      amount: 45.5,
      currency: 'RON',
      vendor: 'Carul Cu Bere',
      establishmentType: 'bar',
      category: 'Dinner',
    }));
  });

  it('does not treat a street name in the address as a grocery store, and uses the time for the meal', async () => {
    const parsed = await parseReceiptText(
      ["JOE'S PIZZA", '123 Market St', '09/05/2026 7:42 PM', 'Latte 4.50', 'Pizza 22.00', 'Subtotal 26.50', 'Tax 2.35', 'Total $28.85', 'VISA'].join('\n'),
      { fallbackCurrency: 'USD' }
    );
    expect(parsed).toEqual(expect.objectContaining({
      vendor: "Joe's Pizza",
      expenseTime: '19:42',
      establishmentType: 'restaurant',
      category: 'Dinner',
      amount: 28.85,
    }));
  });

  it('skips greeting and address lines when choosing the vendor', async () => {
    const parsed = await parseReceiptText(
      ['WELCOME TO', 'The Corner Bistro', '42 Elm Street', 'Tel 555-0100', '2026-09-06 12:15', 'Total 31.20'].join('\n'),
      { fallbackCurrency: 'USD' }
    );
    expect(parsed.vendor).toBe('The Corner Bistro');
    expect(parsed.category).toBe('Lunch');
  });

  it('a cafe in the afternoon is lunch, not breakfast', async () => {
    const parsed = await parseReceiptText(['Blue Bottle Coffee', 'Time 13:05', 'Total $9.75'].join('\n'), { fallbackCurrency: 'USD' });
    expect(parsed.category).toBe('Lunch');
  });

  describe('parseMoney', () => {
    it.each([
      ['45,50', 45.5],
      ['45.50', 45.5],
      ['1,234.56', 1234.56],
      ['1.234,56', 1234.56],
      ['1 234,56', 1234.56],
      ["1'234.56", 1234.56],
      ['$28.85', 28.85],
    ])('%s -> %s', (raw, expected) => {
      expect(parseMoney(raw)).toBe(expected);
    });
  });

  describe('extractDate', () => {
    it('picks the day/month order that falls inside the trip', () => {
      expect(extractDate('05/09/2026', { fallbackCurrency: 'USD', tripStartDate: '2026-09-01', tripEndDate: '2026-09-10' })).toBe('2026-09-05');
      expect(extractDate('05/09/2026', { fallbackCurrency: 'EUR', tripStartDate: '2026-05-01', tripEndDate: '2026-05-31' })).toBe('2026-05-09');
    });
    it('falls back to month-first for USD and day-first elsewhere', () => {
      expect(extractDate('05/09/2026', { currency: 'USD' })).toBe('2026-05-09');
      expect(extractDate('05/09/2026', { currency: 'EUR' })).toBe('2026-09-05');
      expect(extractDate('13/09/2026', { currency: 'USD' })).toBe('2026-09-13'); // only one valid reading
    });
    it('reads month names', () => {
      expect(extractDate('Date: 5 Sep 2026')).toBe('2026-09-05');
      expect(extractDate('Sep 5, 2026')).toBe('2026-09-05');
      expect(extractDate('05-Sept-26')).toBe('2026-09-05');
    });
    it('rejects impossible dates', () => {
      expect(extractDate('31/02/2026', { currency: 'EUR' })).toBeNull();
    });
  });

  describe('extractTime', () => {
    it.each([
      ['Ora: 20:41', '20:41'],
      ['09/05/2026 7:42 PM', '19:42'],
      ['12:05 am', '00:05'],
      ['12:30 p.m.', '12:30'],
      ['no time here 45,50', null],
    ])('%s -> %s', (text, expected) => {
      expect(extractTime(text)).toBe(expected);
    });
  });

  describe('mealForTime', () => {
    it.each([
      ['07:15', 'Breakfast'], ['10:29', 'Breakfast'], ['10:30', 'Lunch'], ['15:29', 'Lunch'],
      ['15:30', 'Dinner'], ['23:50', 'Dinner'], ['01:30', 'Dinner'], ['04:00', 'Breakfast'],
    ])('%s -> %s', (time, meal) => {
      expect(mealForTime(time)).toBe(meal);
    });
  });

  describe('extractCurrency', () => {
    it('recognises local currency words and symbols', () => {
      expect(extractCurrency('TOTAL 45,50 LEI')).toBe('RON');
      expect(extractCurrency('Razem 20,00 zł')).toBe('PLN');
      expect(extractCurrency('Celkem 250 Kč')).toBe('CZK');
      expect(extractCurrency('Total 12,00 €')).toBe('EUR');
    });
    it('resolves $ and ¥ using the trip currency when that is a possible meaning', () => {
      expect(extractCurrency('Total $20.00', 'CAD')).toBe('CAD');
      expect(extractCurrency('Total $20.00', 'EUR')).toBe('USD');
      expect(extractCurrency('合計 ¥1,200', 'CNY')).toBe('CNY');
      expect(extractCurrency('合計 ¥1,200', 'USD')).toBe('JPY');
    });
    it('does not read a cashier named Ron as Romanian lei', () => {
      expect(extractCurrency('Server: Ron\nTotal 20.00', 'USD')).toBe('USD');
    });
  });

  it('tidies ALL-CAPS vendor names but keeps mixed case as printed', () => {
    expect(tidyVendorName("JOE'S PIZZA")).toBe("Joe's Pizza");
    expect(tidyVendorName('McDonald\'s')).toBe("McDonald's");
    expect(tidyVendorName('*** CAFE DE FLORE ***')).toBe('Cafe De Flore');
  });
});
