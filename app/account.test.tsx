import React from 'react';
import { render } from '@testing-library/react-native';
import { View } from 'react-native';
import AccountTab from './tabs/account';

jest.mock('./tabs/AccountProfileManagement', () => (props: any) => <View testID="account-profile-management" {...props} />);
jest.mock('./tabs/FamilyRelationships', () => (props: any) => <View testID="family-relationships" {...props} />);
jest.mock('./tabs/AccountTraits', () => (props: any) => <View testID="account-traits" {...props} />);

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
  accountSection: {},
  successCard: {},
  bodyText: {},
  modalLabel: {},
  mapOptionButton: {},
  mapOptionActive: {},
  mapOptionText: {},
  mapOptionActiveText: {},
  divider: {},
  dangerButton: {},
  modalOverlay: {},
  confirmModal: {},
};

describe('AccountTab', () => {
  const defaultProps = {
    backendUrl: '',
    userToken: 'test-token',
    activePage: 'account',
    accountProfile: {
      firstName: 'Test',
      lastName: 'User',
      email: 'test@test.com',
      homeAddress: '',
      preferredAirport: '',
      appearancePreference: 'auto' as const,
    },
    setAccountProfile: jest.fn(),
    familyRelationships: [],
    setFamilyRelationships: jest.fn(),
    fellowTravelers: [],
    setFellowTravelers: jest.fn(),
    showRelationshipDropdown: false,
    setShowRelationshipDropdown: jest.fn(),
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
    traits: [],
    setTraits: jest.fn(),
    selectedTraitNames: new Set<string>(),
    setSelectedTraitNames: jest.fn(),
    traitAge: '',
    setTraitAge: jest.fn(),
    traitGender: 'prefer-not' as const,
    setTraitGender: jest.fn(),
    newTraitName: '',
    setNewTraitName: jest.fn(),
    fetchTraits: jest.fn(),
    fetchTraitProfile: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders its child components', () => {
    const { getByTestId } = render(<AccountTab {...defaultProps} />);
    expect(getByTestId('account-profile-management')).toBeTruthy();
    expect(getByTestId('family-relationships')).toBeTruthy();
    expect(getByTestId('account-traits')).toBeTruthy();
  });
});
