import { parseDto } from '../src/utils/dtoParse';
import { createExpenseDto, listExpensesQueryDto } from '../src/routes/expenseDtos';

describe('expense DTOs', () => {
  it('normalizes create expense input', () => {
    const dto = parseDto(createExpenseDto, {
      tripId: ' trip-1 ',
      expenseDate: ' 2026-04-23 ',
      category: ' Breakfast ',
      amount: '12.50',
      currency: ' usd ',
      amountInTripCurrency: '12.5',
      exchangeRateToTripCurrency: '1',
      exchangeRateDate: ' 2026-04-23 ',
      payerIds: [123],
      forIds: ['member-1'],
      notes: '  coffee  ',
    });

    expect(dto).toEqual({
      tripId: 'trip-1',
      expenseDate: '2026-04-23',
      category: 'Breakfast',
      amount: 12.5,
      currency: 'USD',
      amountInTripCurrency: 12.5,
      exchangeRateToTripCurrency: 1,
      exchangeRateDate: '2026-04-23',
      payerIds: ['123'],
      forIds: ['member-1'],
      notes: 'coffee',
    });
  });

  it('rejects malformed list and create DTOs with field paths', () => {
    expect(() => parseDto(listExpensesQueryDto, {})).toThrow('Request validation failed');
    expect(() =>
      parseDto(createExpenseDto, {
        tripId: 'trip-1',
        expenseDate: '2026-04-23',
        category: 'Breakfast',
        payerIds: 'member-1',
        forIds: ['member-1'],
      })
    ).toThrow('Request validation failed');
  });
});
