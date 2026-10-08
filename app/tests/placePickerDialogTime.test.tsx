/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import PlacePickerDialog from '../components/PlacePickerDialog';
import { getAppTheme } from '../theme/theme';

describe('PlacePickerDialog time field', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  const renderDialog = (theme = getAppTheme('dark', 'light')) =>
    render(
      <PlacePickerDialog
        visible
        defaultDay={1}
        backendUrl=""
        headers={{}}
        onSubmit={() => {}}
        onCancel={() => {}}
        theme={theme}
      />
    );

  it('uses the native themed time wheel on iOS and commits HH:MM', () => {
    Platform.OS = 'ios';
    const theme = getAppTheme('dark', 'light');
    const { getByTestId, getByText } = renderDialog(theme);

    fireEvent.press(getByTestId('place-dialog-time'));
    const picker = getByTestId('native-date-time-picker');
    expect(picker.props.mode).toBe('time');
    expect(picker.props.themeVariant).toBe('dark');
    expect(picker.props.textColor).toBe(theme.colors.text);

    act(() => {
      picker.props.onValueChange({ nativeEvent: {} }, new Date(2026, 0, 1, 14, 30));
    });
    fireEvent.press(getByTestId('place-dialog-time-done'));
    expect(getByText('14:30')).toBeTruthy();
  });

  it('renders a dark-scheme <input type="time"> on web', () => {
    Platform.OS = 'web';
    const theme = getAppTheme('dark', 'light');
    const { getByTestId } = renderDialog(theme);

    const input = getByTestId('place-dialog-time') as any;
    expect(input.props.type).toBe('time');
    expect(input.props.style.colorScheme).toBe('dark');
    expect(input.props.style.color).toBe(theme.colors.text);
  });
});
