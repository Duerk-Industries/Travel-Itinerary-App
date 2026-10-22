import React from 'react';
import { render } from '@testing-library/react-native';
import DropdownOptionButton from '../components/DropdownOptionButton';

// Airport and location dropdowns set a "choosing an option" flag in onPressIn so the text input's onBlur
// (which fires on mouse-down) does not auto-select the first suggestion. react-native-web delays onPressIn
// by 50 ms by default, which loses that race, so options must ask for no delay.
describe('dropdown options report a press immediately', () => {
  it('passes delayPressIn={0} to the pressable', () => {
    const screen = render(
      <DropdownOptionButton styles={{}} onPressIn={() => undefined} onPress={() => undefined}>{null}</DropdownOptionButton>,
    );
    const option = screen.UNSAFE_getByProps({ accessibilityRole: 'menuitem' });
    expect(option.props.delayPressIn).toBe(0);
  });
});
