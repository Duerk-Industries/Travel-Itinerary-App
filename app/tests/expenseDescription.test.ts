/// <reference types="jest" />
import { buildAllExpenses } from '../utils/costs';
import { convertExpensesToCsv } from '../utils/csv';
import { buildItineraryExpenseDescriptions, resolveExpenseDescription } from '../utils/expenseDescription';

const flight = { id: 'f1', carrier: 'Delta', flight_number: 'DL123', departure_airport_code: 'SEA', arrival_airport_code: 'NRT', departureDate: '2026-11-17', cost: 900, passengerIds: ['m1'] };
const lodging = { id: 'l1', name: 'Hotel Grand', checkInDate: '2026-11-18', totalCost: 400 };
const tour = { id: 't1', name: 'Fushimi Inari Tour', date: '2026-11-19', cost: 80 };
const rental = { id: 'c1', vendor: 'Hertz', model: 'Corolla', pickupDate: '2026-11-20', cost: 150 };

describe('expense Description', () => {
  it('uses the linked item name for itinerary expenses, exactly as the Daily Expenses page does', () => {
    const map = buildItineraryExpenseDescriptions({ flights: [flight], lodgings: [lodging], tours: [tour], carRentals: [rental] });
    expect(map).toEqual({
      'flight:f1': 'Delta DL123 · SEA → NRT',
      'lodging:l1': 'Hotel Grand',
      'activity:t1': 'Fushimi Inari Tour',
      'car_rental:c1': 'Hertz · Corolla',
    });
    expect(resolveExpenseDescription({ sourceType: 'flight', sourceId: 'f1', vendor: 'ignored' }, map)).toBe('Delta DL123 · SEA → NRT');
  });

  it("falls back to the expense's own Description (vendor), then notes, then nothing", () => {
    expect(resolveExpenseDescription({ vendor: 'Ramen Ichiran', notes: 'late' })).toBe('Ramen Ichiran');
    expect(resolveExpenseDescription({ vendor: null, notes: 'taxi to hotel' })).toBe('taxi to hotel');
    expect(resolveExpenseDescription({})).toBe('');
    expect(resolveExpenseDescription({ sourceType: 'flight', sourceId: 'gone', vendor: 'Kept' }, {})).toBe('Kept');
  });

  it('carries the same text into the Paid and Incurred CSVs, after Category', () => {
    const expenses = buildAllExpenses(
      [flight], [lodging], [tour], [rental],
      [
        { id: 'e1', expenseDate: '2026-11-17', category: 'Food', amount: 20, vendor: 'Ramen Ichiran', notes: 'late', payerIds: ['m1'], forIds: ['m1'] },
        { id: 'e2', expenseDate: '2026-11-18', category: 'Transport', amount: 10, notes: 'taxi', payerIds: ['m1'], forIds: ['m1'] },
        { id: 'e3', expenseDate: '2026-11-19', category: 'Misc', amount: 5, payerIds: ['m1'], forIds: ['m1'] },
        { id: 'e4', expenseDate: '2026-11-17', category: 'Flights', amount: 900, sourceType: 'flight', sourceId: 'f1', payerIds: ['m1'], forIds: ['m1'] },
      ],
      'USD', ['m1']
    );
    for (const expenseType of ['paid', 'incurred'] as const) {
      const csv = convertExpensesToCsv({ expenses, members: [{ id: 'm1', firstName: 'Alex' }], formatMemberName: (m) => m.firstName ?? '', coveredBy: {}, expenseType });
      const lines = csv.split('\n');
      expect(lines[0]).toBe('Date,Category,Description,Alex');
      expect(lines.slice(1)).toEqual([
        '2026-11-17,Flights,Delta DL123 · SEA → NRT,900.00',
        '2026-11-18,Lodging,Hotel Grand,400.00',
        '2026-11-19,Activities,Fushimi Inari Tour,80.00',
        '2026-11-20,Car Rentals,Hertz · Corolla,150.00',
        '2026-11-17,Food,Ramen Ichiran,20.00',
        '2026-11-18,Transport,taxi,10.00',
        '2026-11-19,Misc,,5.00',
      ]);
    }
  });
});
