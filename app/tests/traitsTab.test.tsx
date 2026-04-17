/**
 * @jest-environment node
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { TraitsTab } from '../tabs/traits';

describe('TraitsTab interest weights', () => {
  const styles = {
    card: {},
    traitsSection: {},
    sectionTitle: {},
    helperText: {},
    input: {},
    traitGrid: {},
    traitChip: {},
    traitChipSelected: {},
    traitChipText: {},
    traitChipTextSelected: {},
    modalLabel: {},
    row: {},
    cellText: {},
    button: {},
    smallButton: {},
    buttonText: {},
  };

  const defaultProps = {
    backendUrl: 'http://localhost',
    userToken: 'token',
    traits: [],
    setTraits: jest.fn(),
    selectedTraitNames: new Set<string>(),
    setSelectedTraitNames: jest.fn(),
    traitAge: '34',
    setTraitAge: jest.fn(),
    traitGender: 'female' as const,
    setTraitGender: jest.fn(),
    newTraitName: '',
    setNewTraitName: jest.fn(),
    headers: {},
    jsonHeaders: {},
    fetchTraits: jest.fn(async () => undefined),
    fetchTraitProfile: jest.fn(async () => undefined),
    styles,
  };

  test('shows labeled interest weight controls', () => {
    const { getByText, getAllByText } = render(<TraitsTab {...defaultProps} />);

    expect(getByText('Interest Weights')).toBeTruthy();
    expect(getAllByText('Outdoors').length).toBeGreaterThan(0);
    expect(getAllByText('Adventure').length).toBeGreaterThan(0);
    expect(getAllByText('Culture').length).toBeGreaterThan(0);
    expect(getAllByText('Food').length).toBeGreaterThan(0);
    expect(getAllByText('Nightlife').length).toBeGreaterThan(0);
    expect(getAllByText('Relaxing').length).toBeGreaterThan(0);
    expect(getAllByText('Photography').length).toBeGreaterThan(0);
    expect(getAllByText('Authentic/Local').length).toBeGreaterThan(0);
    expect(getAllByText('Iconic Landmarks').length).toBeGreaterThan(0);
  });
});
