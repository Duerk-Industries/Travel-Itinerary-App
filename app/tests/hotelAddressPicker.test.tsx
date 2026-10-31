/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import HotelAddressPicker from '../components/HotelAddressPicker';

const styles = { input: {}, cellText: {} };
const hotels = [{ id: 'h1', name: 'Harbor Hotel', address: ' 1 Quay St ', checkInDate: '2027-05-10', checkOutDate: '2027-05-12' }] as any;

describe('HotelAddressPicker', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  it('lists Custom location first on native and hands off to the text field without changing the address', () => {
    Platform.OS = 'ios';
    const onSelect = jest.fn();
    const onCustom = jest.fn();
    const { getByTestId, queryByTestId, UNSAFE_getAllByProps } = render(
      <HotelAddressPicker hotels={hotels} date="2027-05-11" onSelect={onSelect} onCustom={onCustom} styles={styles} testID="dep" />
    );
    fireEvent.press(getByTestId('dep'));
    expect(UNSAFE_getAllByProps({ accessibilityRole: 'button' }).map((node) => node.props.testID)).toEqual(['dep', 'dep-custom', 'dep-h1']);
    fireEvent.press(getByTestId('dep-custom'));
    expect(onCustom).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(queryByTestId('dep-custom')).toBeNull();
  });

  it('still fills in a hotel address when one is picked', () => {
    Platform.OS = 'ios';
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <HotelAddressPicker hotels={hotels} date="2027-05-11" onSelect={onSelect} onCustom={jest.fn()} styles={styles} testID="dep" />
    );
    fireEvent.press(getByTestId('dep'));
    fireEvent.press(getByTestId('dep-h1'));
    expect(onSelect).toHaveBeenCalledWith('1 Quay St');
  });

  it('offers Custom location on web too', () => {
    Platform.OS = 'web';
    const onCustom = jest.fn();
    const { UNSAFE_getByType } = render(
      <HotelAddressPicker hotels={hotels} date="2027-05-11" onSelect={jest.fn()} onCustom={onCustom} styles={styles} testID="dep" />
    );
    UNSAFE_getByType('select' as never).props.onChange({ target: { value: 'custom' } });
    expect(onCustom).toHaveBeenCalledTimes(1);
  });
});
