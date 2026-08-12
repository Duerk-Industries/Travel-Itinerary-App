/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render } from '@testing-library/react-native';
import DestinationPlaceholderCard from '../components/DestinationPlaceholderCard';

// Covers implementation-plan-ux-remediation.md Initiative B: the designed
// gradient placeholder that replaced the plain black/grey fallback tile for
// a missing trip/day cover photo.
describe('DestinationPlaceholderCard', () => {
  it('renders the destination name as its label', () => {
    const { getByText } = render(<DestinationPlaceholderCard title="Kyoto" testID="placeholder" />);
    expect(getByText('Kyoto')).toBeTruthy();
  });

  it('falls back to a generic label when no title is given', () => {
    const { getByText } = render(<DestinationPlaceholderCard testID="placeholder" />);
    expect(getByText('Your destination')).toBeTruthy();
  });

  it('falls back to a generic label for a blank/whitespace-only title', () => {
    const { getByText } = render(<DestinationPlaceholderCard title="   " testID="placeholder" />);
    expect(getByText('Your destination')).toBeTruthy();
  });

  it('honors a custom testID', () => {
    const { getByTestId } = render(<DestinationPlaceholderCard title="Lisbon" testID="day-1-placeholder" />);
    expect(getByTestId('day-1-placeholder')).toBeTruthy();
  });

  it('deterministically picks the same palette for the same destination name', () => {
    const first = render(<DestinationPlaceholderCard title="Reykjavik" testID="placeholder" />);
    const firstColor = (first.getByTestId('placeholder').props.style as any[]).find((s) => s?.backgroundColor)?.backgroundColor;
    first.unmount();

    const second = render(<DestinationPlaceholderCard title="Reykjavik" testID="placeholder" />);
    const secondColor = (second.getByTestId('placeholder').props.style as any[]).find((s) => s?.backgroundColor)?.backgroundColor;

    expect(firstColor).toBeDefined();
    expect(firstColor).toBe(secondColor);
  });

  it('merges the caller-provided style with its own background styling', () => {
    const { getByTestId } = render(
      <DestinationPlaceholderCard title="Porto" style={{ height: 180 }} testID="placeholder" />
    );
    const node = getByTestId('placeholder');
    const flattened = Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
    expect(flattened.height).toBe(180);
    expect(flattened.backgroundColor).toBeDefined();
  });
});
