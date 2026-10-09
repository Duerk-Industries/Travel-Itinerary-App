/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

let mockWindowWidth = 800;

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback',
  TouchableHighlight: 'TouchableHighlight',
  Pressable: 'Pressable',
  View: 'View',
  Image: 'Image',
  ImageBackground: 'ImageBackground',
  FlatList: 'FlatList',
  SectionList: 'SectionList',
  Switch: 'Switch',
  Modal: 'Modal',
  SafeAreaView: 'SafeAreaView',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T) => styles,
    flatten: (style: unknown) => style,
  },
  useWindowDimensions: () => ({ width: mockWindowWidth, height: 600 }),
  useColorScheme: () => 'light',
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LedgerTab = require('../tabs/ledger').default as React.FC<any>;

const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  lastRow: {},
  headerText: {},
  cellText: {},
  row: {},
  button: {},
  smallButton: {},
  buttonText: {},
  dangerButton: {},
  dangerButtonText: {},
};

const trip = { id: 't1', currency: 'USD', name: 'Trip' };
const groupMembers = [
  { id: 'm1', firstName: 'Alex', lastName: 'Rider', status: 'active' as const },
  { id: 'm2', firstName: 'Blair', lastName: 'Lee', status: 'active' as const },
];
const paidTotals = { m1: 150, m2: 200 };
const usedTotals = { m1: 150, m2: 200 };

const renderLedger = () =>
  render(
    <LedgerTab
      trip={trip}
      groupMembers={groupMembers}
      reportableMembers={groupMembers}
      paidTotals={paidTotals}
      usedTotals={usedTotals}
      styles={styles}
      downloadCsv={jest.fn()}
      findActiveTrip={() => trip}
      onNavigate={() => {}}
      coveredBy={{}}
      setCoveredBy={jest.fn()}
      formatMemberName={(m: any) => `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()}
      payerName={(id: string) => id}
      saveCoveredBy={async () => {}}
      payments={[]}
      currentUserMemberId={null}
      onAddPayment={async () => {}}
      onDeletePayment={async () => {}}
    />,
  );

describe('LedgerTab responsive layout', () => {
  afterEach(() => {
    mockWindowWidth = 800;
  });

  it('renders the desktop table at wide viewports', async () => {
    mockWindowWidth = 1024;
    const { getByTestId, queryByTestId } = renderLedger();
    expect(await waitFor(() => getByTestId('ledger-table'))).toBeTruthy();
    expect(queryByTestId('ledger-cards')).toBeNull();
    expect(getByTestId('ledger-row-m1')).toBeTruthy();
    expect(getByTestId('ledger-overall-row')).toBeTruthy();
  });

  it('renders card list at narrow viewports (phone)', async () => {
    mockWindowWidth = 480;
    const { getByTestId, queryByTestId } = renderLedger();
    expect(await waitFor(() => getByTestId('ledger-cards'))).toBeTruthy();
    expect(queryByTestId('ledger-table')).toBeNull();
    expect(getByTestId('ledger-row-m1')).toBeTruthy();
    expect(getByTestId('ledger-row-m2')).toBeTruthy();
    expect(getByTestId('ledger-overall-row')).toBeTruthy();
  });

  it('renders the settlement matrix at wide viewports', async () => {
    mockWindowWidth = 1024;
    const { getByTestId, queryByTestId } = renderLedger();
    expect(await waitFor(() => getByTestId('settlement-matrix'))).toBeTruthy();
    expect(queryByTestId('settlement-list')).toBeNull();
  });

  it('renders settlement as a who-pays-whom list at narrow viewports', async () => {
    mockWindowWidth = 480;
    // m1 paid 100 and used 200; m2 paid 300 and used 200 → m1 pays m2 $100.
    const { getByTestId, queryByTestId } = render(
      <LedgerTab
        trip={trip}
        groupMembers={groupMembers}
        reportableMembers={groupMembers}
        paidTotals={{ m1: 100, m2: 300 }}
        usedTotals={{ m1: 200, m2: 200 }}
        styles={styles}
        downloadCsv={jest.fn()}
        findActiveTrip={() => trip}
        onNavigate={() => {}}
        coveredBy={{}}
        setCoveredBy={jest.fn()}
        formatMemberName={(m: any) => `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()}
        payerName={(id: string) => id}
        saveCoveredBy={async () => {}}
        payments={[]}
        currentUserMemberId={null}
        onAddPayment={async () => {}}
        onDeletePayment={async () => {}}
      />,
    );
    expect(await waitFor(() => getByTestId('settlement-list'))).toBeTruthy();
    expect(queryByTestId('settlement-matrix')).toBeNull();
    expect(getByTestId('settlement-transfer-m1-m2')).toBeTruthy();
    expect(queryByTestId('settlement-transfer-m2-m1')).toBeNull();
  });

  it('shows a settled-up message at narrow viewports when nobody owes anything', async () => {
    mockWindowWidth = 480;
    const { getByTestId, queryByTestId } = renderLedger();
    expect(await waitFor(() => getByTestId('settlement-settled'))).toBeTruthy();
    expect(queryByTestId('settlement-list')).toBeNull();
  });

  it('lists booking costs with an "Added to group tab" tag and short phone payment rows', async () => {
    mockWindowWidth = 480;
    const { getByTestId, getByText } = render(
      <LedgerTab
        trip={trip}
        groupMembers={groupMembers}
        reportableMembers={groupMembers}
        paidTotals={paidTotals}
        usedTotals={usedTotals}
        styles={styles}
        downloadCsv={jest.fn()}
        findActiveTrip={() => trip}
        onNavigate={() => {}}
        coveredBy={{}}
        setCoveredBy={jest.fn()}
        formatMemberName={(m: any) => `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()}
        payerName={(id: string) => id}
        saveCoveredBy={async () => {}}
        bookingExpenses={[
          { id: 'lodging-l1', date: '2026-10-29', category: 'Lodging', description: 'Alfama apartment', amount: 1180, currency: 'USD', payerIds: ['m1'], forIds: ['m1', 'm2'] },
        ]}
        payments={[{ id: 'p1', tripId: 't1', payerId: 'm2', receiverId: 'm1', paymentDate: '2026-11-02', amountCents: 15000 }]}
        currentUserMemberId={null}
        onAddPayment={async () => {}}
        onDeletePayment={async () => {}}
      />,
    );
    expect(await waitFor(() => getByTestId('ledger-booking-lodging-l1'))).toBeTruthy();
    expect(getByText('✓ Added to group tab')).toBeTruthy();
    expect(getByText(/Nov 2 · Blair Lee paid Alex Rider/)).toBeTruthy();
  });

  it('omits the bookings card when no costs came from bookings', async () => {
    mockWindowWidth = 480;
    const { getByTestId, queryByTestId } = renderLedger();
    expect(await waitFor(() => getByTestId('ledger-summary'))).toBeTruthy();
    expect(queryByTestId('ledger-bookings')).toBeNull();
  });

  it('shows empty state card when there are no travelers', async () => {
    mockWindowWidth = 480;
    const { getByTestId, queryByTestId } = render(
      <LedgerTab
        trip={trip}
        groupMembers={[]}
        reportableMembers={[]}
        paidTotals={{}}
        usedTotals={{}}
        styles={styles}
        downloadCsv={jest.fn()}
        findActiveTrip={() => trip}
        onNavigate={() => {}}
        coveredBy={{}}
        setCoveredBy={jest.fn()}
        formatMemberName={(m: any) => `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()}
        payerName={(id: string) => id}
        saveCoveredBy={async () => {}}
        payments={[]}
        currentUserMemberId={null}
        onAddPayment={async () => {}}
        onDeletePayment={async () => {}}
      />,
    );
    expect(await waitFor(() => getByTestId('ledger-empty'))).toBeTruthy();
    expect(queryByTestId('ledger-overall-row')).toBeNull();
  });
});
