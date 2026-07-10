/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

let mockWindowWidth = 800;

jest.mock('react-native', () => {
  const React = require('react');
  type FlatListMockProps<T> = {
    data: ReadonlyArray<T>;
    keyExtractor?: (item: T, index: number) => string;
    renderItem: (info: { item: T; index: number }) => React.ReactElement | null;
    testID?: string;
  };
  const FlatListMock = <T,>(props: FlatListMockProps<T>) => {
    const children = props.data.map((item, index) => {
      const key = props.keyExtractor ? props.keyExtractor(item, index) : String(index);
      return React.cloneElement(
        props.renderItem({ item, index }) ?? React.createElement('View'),
        { key },
      );
    });
    return React.createElement('View', { testID: props.testID }, children);
  };
  return {
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
    FlatList: FlatListMock,
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
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DailyExpensesTab = require('../tabs/dailyExpenses').default as React.FC<any>;

const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  row: {},
  button: {},
  smallButton: {},
  buttonText: {},
  headerText: {},
  input: {},
  dropdown: {},
  selectButtonRow: {},
  selectCaret: {},
  dropdownList: {},
  dropdownOption: {},
  cellText: {},
  placeholderText: {},
  dateInputWrap: {},
  dateTouchable: {},
  dateIcon: {},
  payerBox: {},
  payerChips: {},
  payerChip: {},
  removeText: {},
  payerOptions: {},
  divider: {},
  tableScroll: {},
  tableScrollContent: {},
  table: {},
  tableRow: {},
  tableHeader: {},
  cell: {},
  lastCell: {},
  lastRow: {},
  linkText: {},
  modalOverlay: {},
  modalCard: {},
  detailModal: {},
  detailModalScroll: {},
  tableActionButton: {},
  tableActionButtonDanger: {},
  dailyExpenseDayCard: { backgroundColor: 'theme-card' },
  dailyExpensesVerticalScroll: { width: '100%' },
  dailyExpensesVerticalContent: { paddingBottom: 24 },
};

const trip = {
  id: 't1',
  groupId: 'g1',
  name: 'Test Trip',
  startDate: '2025-02-01',
  endDate: '2025-02-02',
  currency: 'EUR',
};

const groupMembers = [
  { id: 'm1', firstName: 'Alex', lastName: 'Rider', status: 'active' as const },
  { id: 'm2', firstName: 'Blair', lastName: 'Lee', status: 'active' as const },
];

const expenses = [
  {
    id: 'e1',
    tripId: 't1',
    groupId: 'g1',
    userId: 'u1',
    expenseDate: '2025-02-01',
    category: 'Breakfast',
    amount: 12,
    currency: 'EUR',
    payerIds: ['m1'],
    forIds: ['m1', 'm2'],
    createdAt: '2025-02-01T10:00:00Z',
  },
];

const renderTab = () =>
  render(
    <DailyExpensesTab
      backendUrl="http://example.test"
      headers={{}}
      jsonHeaders={{}}
      trip={trip}
      groupMembers={groupMembers}
      expenses={expenses}
      setExpenses={() => {}}
      defaultPayerId="m1"
      styles={styles}
    />,
  );

describe('DailyExpensesTab responsive layout', () => {
  afterEach(() => {
    mockWindowWidth = 800;
  });

  it('renders the wide-grid table at desktop widths', () => {
    mockWindowWidth = 1024;
    const { getByTestId, queryByTestId } = renderTab();
    expect(getByTestId('daily-expenses-table')).toBeTruthy();
    expect(queryByTestId('daily-expenses-cards')).toBeNull();
  });

  it('renders day cards at narrow widths and only lists non-zero categories', () => {
    mockWindowWidth = 480;
    const { getByTestId, queryByTestId, queryByText } = renderTab();
    expect(getByTestId('daily-expenses-cards')).toBeTruthy();
    expect(queryByTestId('daily-expenses-table')).toBeNull();
    expect(getByTestId('daily-expenses-cards').props.nestedScrollEnabled).toBe(true);
    expect(getByTestId('daily-expenses-cards').props.showsVerticalScrollIndicator).toBe(true);
    expect(getByTestId('daily-expenses-cards').props.style).toEqual(
      expect.arrayContaining([
        styles.dailyExpensesVerticalScroll,
        expect.objectContaining({ maxHeight: 380, flexGrow: 0 }),
      ]),
    );

    expect(getByTestId('daily-expenses-card-2025-02-01')).toBeTruthy();
    expect(getByTestId('daily-expenses-card-2025-02-01').props.style).toEqual(
      expect.arrayContaining([styles.dailyExpenseDayCard]),
    );
    expect(getByTestId('daily-expenses-card-2025-02-02')).toBeTruthy();

    // Breakfast row should appear for day 1, and not for day 2 (which has no expenses)
    expect(getByTestId('expense-cell-2025-02-01-Breakfast')).toBeTruthy();
    expect(queryByTestId('expense-cell-2025-02-02-Breakfast')).toBeNull();
    expect(queryByText('No expenses recorded.')).toBeTruthy();
  });

  it('opens the detail modal when a category row is tapped in narrow layout', () => {
    mockWindowWidth = 480;
    const { getByTestId, queryByTestId } = renderTab();
    expect(queryByTestId('expense-detail-modal')).toBeNull();
    fireEvent.press(getByTestId('expense-cell-2025-02-01-Breakfast'));
    expect(getByTestId('expense-detail-modal')).toBeTruthy();
  });

  it('renders a day card per trip date in the vertical scroll area', () => {
    mockWindowWidth = 480;
    const tripTwoWeeks = {
      ...trip,
      startDate: '2025-02-01',
      endDate: '2025-02-14',
    };
    const { getByTestId } = render(
      <DailyExpensesTab
        backendUrl="http://example.test"
        headers={{}}
        jsonHeaders={{}}
        trip={tripTwoWeeks}
        groupMembers={groupMembers}
        expenses={expenses}
        setExpenses={() => {}}
        defaultPayerId="m1"
        styles={styles}
      />,
    );

    // Every day should produce a keyed card — virtualization does not change the data contract.
    for (let day = 1; day <= 14; day += 1) {
      const date = `2025-02-${day.toString().padStart(2, '0')}`;
      expect(getByTestId(`daily-expenses-card-${date}`)).toBeTruthy();
    }
  });
});
