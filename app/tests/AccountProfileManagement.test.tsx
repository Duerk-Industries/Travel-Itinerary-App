/// <reference types="jest" />
/// <reference types="node" />
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AccountProfileManagement from '../tabs/AccountProfileManagement';
import { getAppTheme } from '../theme/theme';

const theme = getAppTheme('auto', null);

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
  dangerButtonText: {},
  modalOverlay: {},
  confirmModal: {},
  dropdownList: {},
  dropdownOption: {},
  cellText: {},
  placeholderText: {},
};

describe('AccountProfileManagement', () => {
  const defaultProps = {
    theme,
    backendUrl: '',
    userToken: 'test-token',
    activePage: 'account',
    accountProfile: {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@test.com',
      homeAddress: '123 Main St, Austin, TX',
      preferredAirport: 'AUS',
      appearancePreference: 'auto' as const,
      temperatureUnit: 'fahrenheit' as const,
    },
    setAccountProfile: jest.fn(),
    setUserToken: jest.fn(),
    setUserName: jest.fn(),
    setUserEmail: jest.fn(),
    mapApp: 'google' as const,
    onChangeMapApp: jest.fn(),
    appearancePreference: 'auto' as const,
    onChangeAppearancePreference: jest.fn(),
    saveSession: jest.fn(),
    headers: {},
    jsonHeaders: {},
    airportOptions: [],
    onSearchAirports: jest.fn(),
    logout: jest.fn(),
    styles: styles,
  };

  it('renders the account profile section', () => {
    const { getByText, getByPlaceholderText } = render(<AccountProfileManagement {...defaultProps} />);
    expect(getByText('Account')).toBeTruthy();
    expect(getByPlaceholderText('First name')).toBeTruthy();
    expect(getByText(/123 Main St, Austin/)).toBeTruthy();
    expect(getByPlaceholderText('Preferred airport (optional)')).toBeTruthy();
    expect(getByText('Save Profile')).toBeTruthy();
  });

  it('sets the calendar preference beside maps on Preferences', () => {
    const setAccountProfile = jest.fn();
    const { getByText } = render(<AccountProfileManagement {...defaultProps} activePage="account-preferences" setAccountProfile={setAccountProfile} />);
    expect(getByText('Preferred calendar app')).toBeTruthy();
    fireEvent.press(getByText('Apple Calendar'));
    expect(setAccountProfile.mock.calls[0][0](defaultProps.accountProfile).calendarPreference).toBe('apple');
  });

  it('updates the selected temperature preference', () => {
    const setAccountProfile = jest.fn();
    const { getByText } = render(
      <AccountProfileManagement {...defaultProps} activePage="account-preferences" setAccountProfile={setAccountProfile} />
    );

    fireEvent.press(getByText('Celsius'));

    expect(setAccountProfile).toHaveBeenCalledWith(expect.any(Function));
    const updater = setAccountProfile.mock.calls[0][0];
    expect(updater(defaultProps.accountProfile)).toEqual({
      ...defaultProps.accountProfile,
      temperatureUnit: 'celsius',
    });
  });

  it('moves all preference controls off Profile and onto Preferences', () => {
    const view = render(<AccountProfileManagement {...defaultProps} />);
    for (const label of ['Preferred maps app', 'Preferred calendar app', 'Appearance', 'Temperature', 'Update saved trips']) {
      expect(view.queryByText(label)).toBeNull();
    }
    view.rerender(<AccountProfileManagement {...defaultProps} activePage="account-preferences" />);
    for (const label of ['Preferred maps app', 'Preferred calendar app', 'Appearance', 'Temperature', 'Update saved trips', 'Save Preferences']) {
      expect(view.getByText(label)).toBeTruthy();
    }
    expect(view.queryByPlaceholderText('First name')).toBeNull();
    expect(view.queryByText('Change Password')).toBeNull();
  });

  it('saves only preference fields from the Preferences page', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ user: defaultProps.accountProfile }) } as Response);
    try {
      const view = render(<AccountProfileManagement {...defaultProps} activePage="account-preferences" />);
      fireEvent.press(view.getByText('Save Preferences'));
      await waitFor(() => expect(view.getByText('Preferences updated')).toBeTruthy());
      const request = fetcher.mock.calls.find(([url, options]) => String(url).endsWith('/api/account/profile') && options?.method === 'PATCH');
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({ mapPreference: 'google', calendarPreference: 'google', appearancePreference: 'auto', temperatureUnit: 'fahrenheit' });
    } finally { fetcher.mockRestore(); }
  });

  it('opens the home address editor dialog', () => {
    const { getByText, getByPlaceholderText } = render(<AccountProfileManagement {...defaultProps} />);
    fireEvent.press(getByText(/123 Main St, Austin/));
    expect(getByText('Home Address')).toBeTruthy();
    expect(getByPlaceholderText('Address line 1')).toBeTruthy();
    expect(getByPlaceholderText('Country')).toBeTruthy();
  });

  it('wraps the address editor fields in a height-capped scroll area so short screens can reach Save', () => {
    const { getByText, getByTestId } = render(<AccountProfileManagement {...defaultProps} />);
    fireEvent.press(getByText(/123 Main St, Austin/));

    const scroll = getByTestId('address-editor-scroll');
    expect(scroll.props.style.maxHeight).toEqual(expect.any(Number));
    expect(getByText('Save Address')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
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

  it('hides Financial Connections when Plaid is disabled', () => {
    const { queryByText } = render(<AccountProfileManagement {...defaultProps} plaidEnabled={false} />);

    expect(queryByText('Financial Connections')).toBeNull();
    expect(queryByText('Connect Bank Account')).toBeNull();
  });

  it('shows Financial Connections when Plaid is enabled', () => {
    const { getByText } = render(<AccountProfileManagement {...defaultProps} plaidEnabled />);

    expect(getByText('Financial Connections')).toBeTruthy();
    expect(getByText('Connect Bank Account')).toBeTruthy();
  });

  it('shows a city and uppercase code for a saved lowercase preferred airport', () => {
    const view = render(<AccountProfileManagement {...defaultProps} accountProfile={{ ...defaultProps.accountProfile, preferredAirport: 'bos' }} />);
    expect(view.getByPlaceholderText('Preferred airport (optional)').props.value).toBe('Boston (BOS)');
    expect(view.queryByTestId('blog-public-default-setting')).toBeNull();
  });

  it('resolves an airport outside the fallback list and remembers its city label', async () => {
    const onSearchAirports = jest.fn();
    const profile = { ...defaultProps.accountProfile, preferredAirport: 'hnd' };
    const view = render(<AccountProfileManagement {...defaultProps} accountProfile={profile} onSearchAirports={onSearchAirports} />);
    await waitFor(() => expect(onSearchAirports).toHaveBeenCalledWith('HND'));
    view.rerender(<AccountProfileManagement {...defaultProps} accountProfile={profile} onSearchAirports={onSearchAirports} airportOptions={['Tokyo (hnd)']} />);
    expect(view.getByPlaceholderText('Preferred airport (optional)').props.value).toBe('Tokyo (HND)');
    view.rerender(<AccountProfileManagement {...defaultProps} accountProfile={profile} onSearchAirports={onSearchAirports} airportOptions={[]} />);
    expect(view.getByPlaceholderText('Preferred airport (optional)').props.value).toBe('Tokyo (HND)');
  });

  it('uses airport autocomplete suggestions for preferred airport', async () => {
    const onSearchAirports = jest.fn();
    const setAccountProfile = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <AccountProfileManagement
        {...defaultProps}
        setAccountProfile={setAccountProfile}
        onSearchAirports={onSearchAirports}
        airportOptions={['Austin, TX (AUS)', 'Los Angeles, CA (LAX)']}
      />
    );

    fireEvent.changeText(getByPlaceholderText('Preferred airport (optional)'), 'aus');
    await waitFor(() => expect(onSearchAirports).toHaveBeenCalledWith('AUS'));
    fireEvent.press(getByText('Austin, TX (AUS)'));
    expect(setAccountProfile).toHaveBeenCalled();
  });
});
