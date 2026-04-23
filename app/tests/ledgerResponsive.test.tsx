/**
 * @jest-environment node
 */

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
