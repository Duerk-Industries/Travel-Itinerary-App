/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MapToggleButton from '../components/MapToggleButton';
import { ThemedText } from '../components/ThemedText';

const flat = (style: any) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe('MapToggleButton', () => {
  it('is drawn as an outlined button that says what it does', () => {
    const onPress = jest.fn();
    const { UNSAFE_getByProps, getByText, rerender } = render(<MapToggleButton open={false} onPress={onPress} />);
    const button = UNSAFE_getByProps({ accessibilityRole: 'button' });
    expect(flat(button.props.style)).toMatchObject({ borderWidth: 1, minHeight: 44 });
    expect(button.props.accessibilityState).toMatchObject({ expanded: false });
    fireEvent.press(getByText('Show map'));
    expect(onPress).toHaveBeenCalled();
    rerender(<MapToggleButton open onPress={onPress} />);
    expect(getByText('Hide map')).toBeTruthy();
  });
});

describe('link text', () => {
  it('is underlined, so it reads as something to press even where link and body colors match', () => {
    expect(flat(render(<ThemedText tone="link">Retry map</ThemedText>).getByText('Retry map').props.style).textDecorationLine).toBe('underline');
    expect(flat(render(<ThemedText>Plain</ThemedText>).getByText('Plain').props.style).textDecorationLine).toBeUndefined();
  });
});
