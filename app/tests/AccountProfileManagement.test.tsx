import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AccountProfileManagement from '../tabs/AccountProfileManagement';

const styles = {
  card: {},
  accountSection: {},
  sectionTitle: {},
  helperText: {},
  successCard: {},
  bodyText: {},
  row: {},
  input: {},
  modalLabel: {},
  mapOptionButton: {},
  mapOptionActive: {},
  mapOptionText: {},
  mapOptionActiveText: {},
  button: {},
  buttonText: {},
  divider: {},
  dangerButton: {},
  modalOverlay: {},
  confirmModal: {},
};

describe('AccountProfileManagement', () => {
  const defaultProps = {
    backendUrl: '',
    userToken: 'test-token',
    activePage: 'account',
    accountProfile: {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@test.com',
      homeAddress: '123 Main St, Austin, TX',
      preferredAirport: 'AUS',
    },
    setAccountProfile: jest.fn(),
    setUserToken: jest.fn(),
    setUserName: jest.fn(),
    setUserEmail: jest.fn(),
    mapApp: 'google' as const,
    onChangeMapApp: jest.fn(),
    saveSession: jest.fn(),
    headers: {},
    jsonHeaders: {},
    logout: jest.fn(),
    styles: styles,
  };

  it('renders the account profile section', () => {
    const { getByText, getByPlaceholderText } = render(<AccountProfileManagement {...defaultProps} />);
    expect(getByText('Account')).toBeTruthy();
    expect(getByPlaceholderText('First name')).toBeTruthy();
    expect(getByPlaceholderText('Home address (optional)')).toBeTruthy();
    expect(getByPlaceholderText('Preferred airport (optional)')).toBeTruthy();
    expect(getByText('Save Profile')).toBeTruthy();
  });

  it('shows password editor when "Change Password" is clicked', () => {
    const { getByText, getByPlaceholderText } = render(<AccountProfileManagement {...defaultProps} />);
    fireEvent.press(getByText('Change Password'));
    expect(getByPlaceholderText('Current password')).toBeTruthy();
  });

  it('shows delete confirmation when "Delete Account" is clicked', () => {
    const { getByText } = render(<AccountProfileManagement {...defaultProps} />);
    fireEvent.press(getByText('Delete Account'));
    expect(getByText('Delete account?')).toBeTruthy();
  });
});
