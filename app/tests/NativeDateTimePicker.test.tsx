/// <reference types="jest" />

import React from 'react';
import { act, render } from '@testing-library/react-native';
import NativeDateTimePicker from '../components/NativeDateTimePicker';

describe('NativeDateTimePicker', () => {
  it('bridges the Fabric-safe native events to the app callback contract', () => {
    const onChange = jest.fn();
    const selected = new Date(2026, 8, 22);
    const { getByTestId } = render(
      <NativeDateTimePicker value={new Date(2026, 8, 21)} mode="date" onChange={onChange} />,
    );
    const picker = getByTestId('native-date-time-picker');

    act(() => {
      picker.props.onValueChange({ nativeEvent: { timestamp: selected.getTime(), utcOffset: -240 } }, selected);
    });
    expect(onChange).toHaveBeenCalledWith(
      { type: 'set', nativeEvent: { timestamp: selected.getTime(), utcOffset: -240 } },
      selected,
    );

    act(() => {
      picker.props.onDismiss();
    });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'dismissed' });
  });

  it('forwards minimumDate and maximumDate to the native picker', () => {
    const min = new Date(2026, 8, 1);
    const max = new Date(2026, 8, 30);
    const { getByTestId } = render(
      <NativeDateTimePicker value={new Date(2026, 8, 21)} mode="date" minimumDate={min} maximumDate={max} />,
    );
    const picker = getByTestId('native-date-time-picker');
    expect(picker.props.minimumDate).toBe(min);
    expect(picker.props.maximumDate).toBe(max);
  });
});
