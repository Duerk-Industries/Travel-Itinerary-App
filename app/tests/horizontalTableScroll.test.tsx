/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import HorizontalTableScroll from '../components/HorizontalTableScroll';

describe('HorizontalTableScroll', () => {
  it('enables the cross-platform table scrolling contract', () => {
    const { getByTestId } = render(
      <HorizontalTableScroll testID="table-scroll">
        <Text>Table content</Text>
      </HorizontalTableScroll>,
    );

    const scroll = getByTestId('table-scroll');
    expect(scroll.props.horizontal).toBe(true);
    expect(scroll.props.nestedScrollEnabled).toBe(true);
    expect(scroll.props.showsHorizontalScrollIndicator).toBe(true);
    expect(scroll.props.directionalLockEnabled).toBe(true);
  });
});
