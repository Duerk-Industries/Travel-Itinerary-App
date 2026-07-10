/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render } from '@testing-library/react-native';
import Skeleton from '../components/Skeleton';

describe('Skeleton', () => {
  it('renders with a default testID', () => {
    const { getByTestId } = render(<Skeleton />);
    expect(getByTestId('skeleton')).toBeTruthy();
  });

  it('honors a custom testID', () => {
    const { getByTestId } = render(<Skeleton testID="hero-skeleton" />);
    expect(getByTestId('hero-skeleton')).toBeTruthy();
  });

  it('exposes a progressbar accessibility role', () => {
    const { getByTestId } = render(<Skeleton testID="x" />);
    const node = getByTestId('x');
    expect(node.props.accessibilityRole).toBe('progressbar');
    expect(node.props.accessibilityLabel).toBe('Loading');
  });

  it('merges custom style with the base style', () => {
    const { getByTestId } = render(<Skeleton testID="sized" style={{ width: 200, height: 100 }} />);
    const node = getByTestId('sized');
    const flattened = Array.isArray(node.props.style)
      ? Object.assign({}, ...node.props.style)
      : node.props.style;
    expect(flattened.width).toBe(200);
    expect(flattened.height).toBe(100);
    expect(flattened.backgroundColor).toBeDefined();
  });
});
