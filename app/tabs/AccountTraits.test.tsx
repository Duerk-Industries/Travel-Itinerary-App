/// <reference types="jest" />
/// <reference types="node" />
import React from 'react';
import { render } from '@testing-library/react-native';
import AccountTraits from './AccountTraits';

// Mock the child component
jest.mock('./traits', () => ({
  TraitsTab: (props: any) => <div data-testid="traits-tab" {...props} />,
}));

const styles = {
  card: {},
};

describe('AccountTraits', () => {
  const defaultProps = {
    backendUrl: '',
    userToken: 'test-token',
    headers: {},
    jsonHeaders: {},
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
    styles: styles,
  };

  it('renders the TraitsTab component inside a card', () => {
    const { getByTestId } = render(<AccountTraits {...defaultProps} />);
    expect(getByTestId('traits-tab')).toBeTruthy();
  });

  it('passes all props down to TraitsTab', () => {
    const { getByTestId } = render(<AccountTraits {...defaultProps} />);
    const traitsTab = getByTestId('traits-tab');

    expect(traitsTab.props.backendUrl).toBe(defaultProps.backendUrl);
    expect(traitsTab.props.userToken).toBe(defaultProps.userToken);
    expect(traitsTab.props.traits).toBe(defaultProps.traits);
    expect(traitsTab.props.setTraits).toBe(defaultProps.setTraits);
  });
});