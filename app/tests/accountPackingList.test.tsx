/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';
import AccountTab from '../tabs/account';

jest.mock('../tabs/AccountProfileManagement', () => (props: any) => <View testID="account-profile-management" {...props} />);
jest.mock('../tabs/FamilyRelationships', () => (props: any) => <View testID="family-relationships" {...props} />);
jest.mock('../tabs/AccountTraits', () => (props: any) => <View testID="account-traits" {...props} />);

const styles = {
  button: {},
  buttonText: {},
};

const defaultProps = {
  backendUrl: 'http://localhost',
  userToken: 'test-token',
  activePage: 'account',
  accountProfile: {
    firstName: 'Test',
    lastName: 'User',
    email: 'test@test.com',
    homeAddress: '',
    preferredAirport: '',
    appearancePreference: 'auto' as const,
    temperatureUnit: 'fahrenheit' as const,
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
  styles,
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

describe('Account profile links', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('links to the fellow travelers, packing list, and travel profile pages', () => {
    const onNavigate = jest.fn();
    const { getByTestId } = render(<AccountTab {...defaultProps} onNavigate={onNavigate} />);

    fireEvent.press(getByTestId('account-link-fellow-travelers'));
    fireEvent.press(getByTestId('account-link-packing-list'));
    fireEvent.press(getByTestId('account-link-travel-profile'));

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'account-fellow-travelers');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'account-packing-list');
    expect(onNavigate).toHaveBeenNthCalledWith(3, 'account-travel-profile');
  });
});
