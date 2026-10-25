/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import ExpenseCovering from '../tabs/ExpenseCovering';
import { Modal } from 'react-native';

const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  row: {},
  dropdown: {},
  input: {},
  cellText: {},
  dropdownList: {},
  dropdownOption: {},
  button: {},
  buttonText: {},
};

describe('ExpenseCovering', () => {
  const mockSetCoveredBy = jest.fn();
  const mockSaveCoveredBy = jest.fn();
  const mockFormatMemberName = (m: any) => `${m.firstName} ${m.lastName}`.trim() || m.guestName || m.email;
  const mockPayerName = (id: string) => {
    const member = [
      { id: 'm1', firstName: 'Alex' },
      { id: 'm2', firstName: 'Blair' },
      { id: 'm3', guestName: 'Casey' },
    ].find(m => m.id === id);
    return member ? (member.firstName || member.guestName || 'Unknown') : 'Unknown';
  };

  const groupMembers = [
    { id: 'm1', firstName: 'Alex', lastName: 'Rider', status: 'active' as const },
    { id: 'm2', firstName: 'Blair', lastName: 'Lee', status: 'active' as const },
    { id: 'm3', firstName: 'Casey', lastName: 'Guest', status: 'active' as const },
  ];

  const defaultProps = {
    groupMembers: groupMembers,
    reportableMembers: groupMembers,
    coveredBy: {},
    setCoveredBy: mockSetCoveredBy,
    formatMemberName: mockFormatMemberName,
    payerName: mockPayerName,
    saveCoveredBy: mockSaveCoveredBy,
    styles: styles,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the Expense Covering section', () => {
    const { getByText } = render(<ExpenseCovering {...defaultProps} />);
    expect(getByText('Expense Covering')).toBeTruthy();
    expect(getByText('Alex Rider is covered by:')).toBeTruthy();
  });

  it('allows selecting a covering person from the dropdown', async () => {
    const { getByTestId, getAllByText } = render(<ExpenseCovering {...defaultProps} />);
    const alexRow = getByTestId('covering-row-m1');

    // Open dropdown for Alex Rider
    fireEvent.press(within(alexRow).getByText('No one'));

    // Select Blair Lee to cover Alex
    await waitFor(() => fireEvent.press(getAllByText('Blair Lee')[0]));

    expect(mockSetCoveredBy).toHaveBeenCalled();
  });

  it('keeps a covered traveler available as a covering option when it would not create a cycle', async () => {
    const { getByTestId, getAllByText } = render(
      <ExpenseCovering {...defaultProps} coveredBy={{ m3: 'm2' }} reportableMembers={groupMembers.filter((member) => member.id !== 'm3')} />
    );
    fireEvent.press(within(getByTestId('covering-row-m1')).getByText('No one'));
    await waitFor(() => expect(getAllByText('Casey Guest')[0]).toBeTruthy());
  });

  it('calls saveCoveredBy when the save button is pressed', () => {
    const { getByText } = render(<ExpenseCovering {...defaultProps} />);
    fireEvent.press(getByText('Save Covering Rules'));
    expect(mockSaveCoveredBy).toHaveBeenCalledTimes(1);
  });

  it('keeps the first row options outside clipped rows and selects a traveler behind later rows', () => {
    const screen = render(<ExpenseCovering {...defaultProps} styles={{ ...styles, row: { overflow: 'hidden', height: 44 } }} />);
    fireEvent.press(within(screen.getByTestId('covering-row-m1')).getByText('No one'));
    expect(screen.UNSAFE_getByType(Modal).props.visible).toBe(true);
    fireEvent.press(screen.getByTestId('covering-select-m1-option-m3'));
    const update = mockSetCoveredBy.mock.calls[0][0];
    expect(update({ m2: 'm3' })).toEqual({ m1: 'm3', m2: 'm3' });
    expect(screen.queryByTestId('covering-select-m1-options')).toBeNull();
  });

  it('can clear a coverage rule from the modal without changing another traveler', () => {
    const screen = render(<ExpenseCovering {...defaultProps} coveredBy={{ m1: 'm2' }} />);
    fireEvent.press(within(screen.getByTestId('covering-row-m1')).getByText('Blair Lee'));
    fireEvent.press(screen.getByTestId('covering-select-m1-option-none'));
    expect(mockSetCoveredBy.mock.calls[0][0]({ m1: 'm2', m3: 'm2' })).toEqual({ m3: 'm2' });
  });
});
