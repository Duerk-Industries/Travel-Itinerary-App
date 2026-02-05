/**
 * @jest-environment node
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TripDetailsTab from '../tabs/tripDetails';

const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  row: {},
  flightTitle: {},
  headerText: {},
  bodyText: {},
  linkText: {},
  buttonText: {},
  divider: {},
  input: {},
  dropdown: {},
  selectButtonRow: {},
  selectCaret: {},
  dropdownList: {},
  dropdownOption: {},
  cellText: {},
  button: {},
};

describe('TripDetailsTab currency dropdown', () => {
  it('calls onUpdateCurrency when selecting a new currency', () => {
    const onUpdateCurrency = jest.fn();
    const trip = {
      id: 't1',
      groupId: 'g1',
      name: 'Currency Trip',
      createdAt: '2025-01-01',
      currency: 'USD',
    };
    const { getByText } = render(
      <TripDetailsTab
        trip={trip as any}
        group={{ id: 'g1', name: 'Group', members: [], invites: [] }}
        styles={styles}
        onSetActive={() => {}}
        onOpenItinerary={() => {}}
        onUpdateCurrency={onUpdateCurrency}
      />
    );

    fireEvent.press(getByText('USD'));
    fireEvent.press(getByText('EUR'));

    expect(onUpdateCurrency).toHaveBeenCalledWith('t1', 'EUR');
  });
});
