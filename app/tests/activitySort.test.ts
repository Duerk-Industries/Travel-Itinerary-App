/// <reference types="jest" />
import { sortActivityRows, type Tour } from '../tabs/activities';

const tour = (id: string, date: string, startTime: string, extra: Partial<Tour> = {}): Tour =>
  ({ id, name: id, date, startTime, activityType: 'Tour', status: 'Proposed', paidBy: [], travelerIds: [], ...extra } as Tour);

// Loaded out of order, the way the table received them in the bug report.
const rows = [
  tour('samba', '2026-11-15', '20:30'),
  tour('christ', '2026-11-15', '08:00'),
  tour('untimed', '2026-11-15', ''),
  tour('santa-teresa', '2026-11-15', '14:00'),
  tour('dinner', '2026-11-16', '19:30'),
  tour('sugarloaf', '2026-11-16', '9:30'),
  tour('urca', '2026-11-16', '12:30'),
];
const ids = (sorted: Tour[]) => sorted.map((row) => row.id);

describe('sortActivityRows', () => {
  it('orders each day by start time when the Date column is sorted, with untimed activities last', () => {
    expect(ids(sortActivityRows(rows, { key: 'date', direction: 'asc' })))
      .toEqual(['christ', 'santa-teresa', 'samba', 'untimed', 'sugarloaf', 'urca', 'dinner']);
  });

  it('keeps each day in time order when the dates run newest first', () => {
    expect(ids(sortActivityRows(rows, { key: 'date', direction: 'desc' })))
      .toEqual(['sugarloaf', 'urca', 'dinner', 'christ', 'santa-teresa', 'samba', 'untimed']);
  });

  it('does the same before any column is chosen', () => {
    expect(ids(sortActivityRows(rows, { key: null, direction: 'asc' })))
      .toEqual(['christ', 'santa-teresa', 'samba', 'untimed', 'sugarloaf', 'urca', 'dinner']);
  });

  it('breaks ties in another column by day and then time', () => {
    const typed = [
      tour('b', '2026-11-16', '09:00', { activityType: 'Tour' }),
      tour('a', '2026-11-15', '18:00', { activityType: 'Tour' }),
      tour('c', '2026-11-15', '07:00', { activityType: 'Tour' }),
      tour('d', '2026-11-15', '12:00', { activityType: 'Class' }),
    ];
    expect(ids(sortActivityRows(typed, { key: 'activityType', direction: 'asc' }))).toEqual(['d', 'c', 'a', 'b']);
  });
});
