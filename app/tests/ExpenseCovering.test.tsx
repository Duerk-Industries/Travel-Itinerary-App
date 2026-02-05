/**
 * @jest-environment node
 */

import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import ExpenseCovering from '../tabs/ExpenseCovering';

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
    { id: 'm3', guestName: 'Casey', status: 'active' as const },
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

  it('calls saveCoveredBy when the save button is pressed', () => {
    const { getByText } = render(<ExpenseCovering {...defaultProps} />);
    fireEvent.press(getByText('Save Covering Rules'));
    expect(mockSaveCoveredBy).toHaveBeenCalledTimes(1);
  });
});