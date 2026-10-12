/** @jest-environment jsdom */
/// <reference types="jest" />
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import AutoGrowTextInput from '../components/AutoGrowTextInput';

const flat = (style: any): Record<string, any> => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : (style ?? {});
const grow = (node: any, height: number) => act(() => { fireEvent(node, 'contentSizeChange', { nativeEvent: { contentSize: { width: 100, height } } }); });

describe('AutoGrowTextInput', () => {
  it('starts one line tall and is not scrollable', () => {
    const view = render(<AutoGrowTextInput testID="in" minHeight={40} maxLines={4} lineHeight={20} />);
    const input = view.getByTestId('in');
    expect(flat(input.props.style).height).toBe(40);
    expect(input.props.scrollEnabled).toBe(false);
  });

  it('grows with its text and only becomes scrollable beyond maxLines', () => {
    const view = render(<AutoGrowTextInput testID="in" minHeight={40} maxLines={4} lineHeight={20} />);
    grow(view.getByTestId('in'), 60);
    expect(flat(view.getByTestId('in').props.style).height).toBe(60);
    expect(view.getByTestId('in').props.scrollEnabled).toBe(false);
    grow(view.getByTestId('in'), 80); // exactly 4 lines + padding: fits
    expect(view.getByTestId('in').props.scrollEnabled).toBe(false);
    grow(view.getByTestId('in'), 200);
    expect(flat(view.getByTestId('in').props.style).height).toBe(100); // 40 - 20 + 4 * 20
    expect(view.getByTestId('in').props.scrollEnabled).toBe(true);
  });

  it('shrinks back when text is removed', () => {
    const view = render(<AutoGrowTextInput testID="in" minHeight={40} maxLines={4} lineHeight={20} />);
    grow(view.getByTestId('in'), 90);
    grow(view.getByTestId('in'), 20);
    expect(flat(view.getByTestId('in').props.style).height).toBe(40);
  });
});
