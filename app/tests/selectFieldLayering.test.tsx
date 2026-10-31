import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { Keyboard, Modal, Platform, ScrollView, View } from 'react-native';
import SelectField from '../components/SelectField';
import KeyboardAwareModal from '../components/KeyboardAwareModal';

const styles = { input: { backgroundColor: '#fff' }, cellText: { color: '#111' }, dropdownList: { position: 'absolute', zIndex: 1 } };
const options = Array.from({ length: 30 }, (_, i) => ({ label: `Traveler ${i}`, value: `${i}` }));
const originalPlatform = Platform.OS;
afterEach(() => Object.assign(Platform, { OS: originalPlatform }));

it.each(['ios', 'android'] as const)('renders %s choices in a modal rather than a clipped inline list', os => {
  Object.assign(Platform, { OS: os });
  const onChange = jest.fn();
  const screen = render(
    <View style={{ overflow: 'hidden', height: 40 }}>
      <SelectField value="" options={options} styles={styles} onChange={onChange} title="Cover expenses" testID="cover" />
      <View style={{ zIndex: 999999 }} />
    </View>
  );
  fireEvent.press(screen.getByLabelText('Cover expenses'));
  const modal = screen.UNSAFE_getByType(Modal);
  expect(modal.props.transparent).toBe(true);
  expect(modal.props.visible).toBe(true);
  const panel = screen.getByTestId('cover-options');
  expect(panel.props.accessibilityViewIsModal).toBe(true);
  expect(within(panel).getByLabelText('Select Traveler 29')).toBeTruthy();
  const scroll = screen.UNSAFE_getByType(ScrollView);
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  fireEvent.press(screen.getByTestId('cover-option-29'));
  expect(onChange).toHaveBeenCalledWith('29');
  expect(screen.queryByTestId('cover-options')).toBeNull();
});

it('places a selector opened within a dialog in its own native modal window', () => {
  const screen = render(<KeyboardAwareModal visible onRequestClose={() => undefined}>
    <SelectField value="" options={options} styles={styles} onChange={jest.fn()} title="Payer" testID="payer" />
  </KeyboardAwareModal>);
  fireEvent.press(screen.getByLabelText('Payer'));
  expect(screen.UNSAFE_getAllByType(Modal)).toHaveLength(2);
  expect(screen.getByTestId('payer-options')).toBeTruthy();
});

it.each(['backdrop', 'cancel', 'hardware back'])('dismisses with %s without changing the selection', action => {
  const onChange = jest.fn();
  const screen = render(<SelectField value="0" options={options} styles={styles} onChange={onChange} title="Payer" testID="payer" />);
  fireEvent.press(screen.getByLabelText('Payer'));
  if (action === 'hardware back') fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  else fireEvent.press(screen.getByLabelText(action === 'cancel' ? 'Cancel selection' : 'Dismiss options', { includeHiddenElements: true }));
  expect(screen.queryByTestId('payer-options')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it('dismisses the keyboard on open so closing the modal cannot refocus a text input', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockClear();
  const screen = render(<SelectField value="" options={options} styles={styles} onChange={jest.fn()} title="Payer" testID="payer" />);
  fireEvent.press(screen.getByLabelText('Payer'));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('does not open a disabled selector', () => {
  const screen = render(<SelectField value="" options={options} styles={styles} onChange={jest.fn()} title="Payer" testID="payer" disabled />);
  fireEvent.press(screen.getByLabelText('Payer'));
  expect(screen.queryByTestId('payer-options')).toBeNull();
});

it('renders only one empty choice on web so keyboard navigation can advance past No one', () => {
  Object.assign(Platform, { OS: 'web' });
  const screen = render(<SelectField value="" options={[{ label: 'No one', value: '' }, ...options]} styles={styles} onChange={jest.fn()} />);
  const values = screen.UNSAFE_getAllByType('option' as never).map(node => node.props.value);
  expect(values.filter(value => value === '')).toHaveLength(1);
});
