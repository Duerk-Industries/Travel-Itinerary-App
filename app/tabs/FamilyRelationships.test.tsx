import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import FamilyRelationships from '../tabs/FamilyRelationships';

const styles = {
  card: {},
  sectionTitle: {},
  helperText: {},
  row: {},
  input: {},
  button: {},
  buttonText: {},
  dropdown: {},
  selectButtonRow: {},
  placeholderText: {},
  selectCaret: {},
};

describe('FamilyRelationships', () => {
  const defaultProps = {
    backendUrl: '',
    userToken: 'test-token',
    headers: {},
    jsonHeaders: {},
    familyRelationships: [],
    setFamilyRelationships: jest.fn(),
    fellowTravelers: [],
    setFellowTravelers: jest.fn(),
    showRelationshipDropdown: false,
    setShowRelationshipDropdown: jest.fn(),
    styles: styles,
  };

  it('renders the "Family & Relationships" section', () => {
    const { getByText } = render(<FamilyRelationships {...defaultProps} />);
    expect(getByText('Family & Relationships')).toBeTruthy();
    expect(getByText('Add Family Member')).toBeTruthy();
  });

  it('renders the "Fellow Travelers" section', () => {
    const { getByText } = render(<FamilyRelationships {...defaultProps} />);
    expect(getByText('Fellow Travelers')).toBeTruthy();
    expect(getByText('Add Fellow Traveler')).toBeTruthy();
  });

  it('can hide the family section while keeping fellow travelers visible', () => {
    const { queryByText, getByText, getByPlaceholderText } = render(
      <FamilyRelationships {...defaultProps} hideFamilySection />
    );
    expect(queryByText('Family & Relationships')).toBeNull();
    expect(getByText('Fellow Travelers')).toBeTruthy();
    expect(getByPlaceholderText('Email (optional)')).toBeTruthy();
  });
});
