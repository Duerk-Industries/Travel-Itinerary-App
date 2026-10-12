/// <reference types="jest" />
/// <reference types="node" />
import { convertExpensesToCsv } from '../utils/csv';

describe('CSV Conversion', () => {
  const members = [
    { id: 'm1', firstName: 'Alex', lastName: 'Rider' },
    { id: 'm2', firstName: 'Blair', lastName: 'Lee' },
    { id: 'm3', firstName: 'Casey', lastName: 'Jones' },
  ];
  const formatMemberName = (m: any) => `${m.firstName} ${m.lastName}`;

  const allExpenses = [
    { date: '2025-01-01', category: 'Flights', description: 'Delta 123 · SEA → NRT', amount: 100, payerIds: ['m1'], forIds: ['m1', 'm2'] },
    { date: '2025-01-02', category: 'Lodging', description: 'Hotel, "Grand" Tokyo', amount: 200, payerIds: ['m2'], forIds: ['m1', 'm2'] },
    { date: '2025-01-03', category: 'Dinner', amount: 60, payerIds: ['m3'], forIds: ['m1', 'm2', 'm3'] },
  ];

  it('should generate correct CSV for paid expenses', () => {
    const coveredBy = {};
    const csv = convertExpensesToCsv({
      expenses: allExpenses,
      members,
      formatMemberName,
      coveredBy,
      expenseType: 'paid',
    });

    const expectedCsv = [
      'Date,Category,Description,Alex Rider,Blair Lee,Casey Jones',
      '2025-01-01,Flights,Delta 123 · SEA → NRT,100.00,0.00,0.00',
      '2025-01-02,Lodging,"Hotel, ""Grand"" Tokyo",0.00,200.00,0.00',
      '2025-01-03,Dinner,,0.00,0.00,60.00',
    ].join('\n');

    expect(csv).toBe(expectedCsv);
  });

  it('should generate correct CSV for incurred expenses with roll-up', () => {
    const coveredBy = { m2: 'm1' }; // Blair is covered by Alex
    const reportableMembers = members.filter((m) => m.id !== 'm2');

    const csv = convertExpensesToCsv({
      expenses: allExpenses,
      members: reportableMembers,
      formatMemberName,
      coveredBy,
      expenseType: 'incurred',
    });

    const expectedCsv = [
      'Date,Category,Description,Alex Rider,Casey Jones',
      '2025-01-01,Flights,Delta 123 · SEA → NRT,100.00,0.00',
      '2025-01-02,Lodging,"Hotel, ""Grand"" Tokyo",200.00,0.00',
      '2025-01-03,Dinner,,40.00,20.00',
    ].join('\n');

    expect(csv).toBe(expectedCsv);
  });
});