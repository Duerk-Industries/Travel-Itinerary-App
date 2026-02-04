import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AccountTab from '../tabs/account';

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
    backendUrl: '',
    userToken: 'test-token',
    activePage: 'account',
    accountProfile: { firstName: 'Test', lastName: 'User', email: 'test@test.com' },
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
    saveSession: jest.fn(),
    headers: {},
    jsonHeaders: {},
    logout: jest.fn(),
    styles: styles,
    traits: [],
    setTraits: jest.fn(),
    selectedTraitNames: new Set(),
    setSelectedTraitNames: jest.fn(),
    traitAge: '',
    setTraitAge: jest.fn(),
    traitGender: 'prefer-not' as const,
    setTraitGender: jest.fn(),
    newTraitName: '',
    setNewTraitName: jest.fn(),
    fetchTraits: jest.fn(),
    fetchTraitProfile: jest.fn(),
    groupMembers: groupMembers,
    reportableMembers: groupMembers,
    coveredBy: {},
    setCoveredBy: mockSetCoveredBy,
    formatMemberName: mockFormatMemberName,
    payerName: mockPayerName,
    saveCoveredBy: mockSaveCoveredBy,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the Account section', () => {
    const { getByText } = render(<AccountTab {...defaultProps} />);
    expect(getByText('Account')).toBeTruthy();
    expect(getByText('Save Profile')).toBeTruthy();
  });
});