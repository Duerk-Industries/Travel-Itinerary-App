/** @jest-environment node */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LedgerTab from '../tabs/ledger';

const people = [
  { id: 'a', firstName: 'Alex' },
  { id: 'b', firstName: 'Blair' },
  { id: 'c', firstName: 'Casey' },
];
type Props = React.ComponentProps<typeof LedgerTab>;
const payment = (id: string, payerId: string, receiverId: string, amountCents: number) => ({
  id, tripId: 'trip', payerId, receiverId, amountCents, paymentDate: '2026-10-27',
});
const exportDetails = (overrides: Partial<Props> = {}) => {
  const downloadCsv = jest.fn();
  const screen = render(<LedgerTab trip={{ id: 'trip', currency: 'USD' }} groupMembers={people} reportableMembers={people}
    paidTotals={{ a: 100, b: 20, c: 0 }} usedTotals={{ a: 30, b: 50, c: 40 }}
    styles={{}} downloadCsv={downloadCsv} findActiveTrip={() => ({ id: 'trip', name: 'Test Trip' })}
    onNavigate={jest.fn()} coveredBy={{}} setCoveredBy={jest.fn()} formatMemberName={(person) => person.firstName ?? ''}
    payerName={(id) => id} saveCoveredBy={async () => {}} payments={[]} currentUserMemberId={null}
    onAddPayment={async () => {}} onDeletePayment={async () => {}} {...overrides} />);
  fireEvent.press(screen.getByText('Export Details'));
  expect(screen.queryByText('Export CSV')).toBeNull();
  expect(downloadCsv).toHaveBeenCalledTimes(1);
  const csv = downloadCsv.mock.calls[0][0] as string;
  screen.unmount();
  return csv.split('\n').map((row) => row.split(','));
};

it('sums repeated and bidirectional payments into separate sent/received columns and calculates each balance', () => {
  const rows = exportDetails({ payments: [
    payment('1', 'b', 'a', 1001), payment('2', 'b', 'a', 2002),
    payment('3', 'c', 'a', 499), payment('4', 'a', 'b', 200),
  ] });
  expect(rows).toEqual([
    ['Person', 'Paid', 'Used', 'Paid to Other Travelers', 'Received from Other Travelers', 'Owed'],
    ['Alex', '100.00', '30.00', '2.00', '35.02', '36.98'],
    ['Blair', '20.00', '50.00', '30.03', '2.00', '-1.97'],
    ['Casey', '0.00', '40.00', '4.99', '0.00', '-35.01'],
    ['Overall', '120.00', '120.00', '37.02', '37.02', '0.00'],
  ]);
});

it('exports zero payments and computes totals from Paid minus Used when no payments exist', () => {
  const rows = exportDetails();
  expect(rows[1]).toEqual(['Alex', '100.00', '30.00', '0.00', '0.00', '70.00']);
  expect(rows[4]).toEqual(['Overall', '120.00', '120.00', '0.00', '0.00', '0.00']);
});

it('rolls covered travelers payments into their covering traveler and excludes internal transfers', () => {
  const rows = exportDetails({ coveredBy: { c: 'b' }, reportableMembers: people.slice(0, 2),
    paidTotals: { a: 100, b: 20 }, usedTotals: { a: 30, b: 90 },
    payments: [payment('1', 'c', 'a', 1000), payment('2', 'a', 'c', 100), payment('3', 'b', 'c', 500)] });
  expect(rows.slice(1)).toEqual([
    ['Alex', '100.00', '30.00', '1.00', '10.00', '61.00'],
    ['Blair', '20.00', '90.00', '10.00', '1.00', '-61.00'],
    ['Overall', '120.00', '120.00', '11.00', '11.00', '0.00'],
  ]);
});
