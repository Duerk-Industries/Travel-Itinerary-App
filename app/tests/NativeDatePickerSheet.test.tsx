/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import NativeDatePickerSheet from '../components/NativeDatePickerSheet';
import NativeDateTimePicker from '../components/NativeDateTimePicker';
import { getAppTheme } from '../theme/theme';

describe('NativeDatePickerSheet', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('uses a spinner inside an explicit sheet on iOS', () => {
    Platform.OS = 'ios';
    const onDone = jest.fn();
    const { getByTestId } = render(
      <NativeDatePickerSheet visible onRequestClose={() => {}} onDone={onDone} testID="shared-date-picker">
        <NativeDateTimePicker value={new Date(2026, 8, 21)} mode="date" />
      </NativeDatePickerSheet>
    );

    expect(getByTestId('native-date-time-picker').props.display).toBe('spinner');
    fireEvent.press(getByTestId('shared-date-picker-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('keeps Android on its platform-default picker display', () => {
    Platform.OS = 'android';
    const { getByTestId } = render(
      <NativeDatePickerSheet visible onRequestClose={() => {}} testID="shared-date-picker">
        <NativeDateTimePicker value={new Date(2026, 8, 21)} mode="date" />
      </NativeDatePickerSheet>
    );

    expect(getByTestId('native-date-time-picker').props.display).toBeUndefined();
  });

  it('renders the Android system dialog bare, without an empty sheet behind it', () => {
    Platform.OS = 'android';
    const { queryByTestId, getByTestId } = render(
      <NativeDatePickerSheet visible onRequestClose={() => {}} onCancel={() => {}} testID="shared-date-picker">
        <NativeDateTimePicker value={new Date(2026, 8, 21)} mode="date" />
      </NativeDatePickerSheet>
    );

    expect(getByTestId('native-date-time-picker')).toBeTruthy();
    expect(queryByTestId('shared-date-picker-done')).toBeNull();
    expect(queryByTestId('shared-date-picker-cancel')).toBeNull();
  });

  it.each([
    ['light', getAppTheme('light', 'dark'), getAppTheme('light', 'dark').colors.primary],
    ['dark', getAppTheme('dark', 'light'), getAppTheme('dark', 'light').colors.link],
  ] as const)('uses a legible Done color on the %s sheet', (_mode, theme, expected) => {
    Platform.OS = 'ios';
    const { getByText } = render(
      <NativeDatePickerSheet visible onRequestClose={() => {}} theme={theme} testID="shared-date-picker">
        <NativeDateTimePicker value={new Date(2026, 8, 21)} mode="date" />
      </NativeDatePickerSheet>
    );

    expect(getByText('Done').props.style.color).toBe(expected);
  });

  it('applies the resolved app theme to the iOS wheel instead of the device default', () => {
    Platform.OS = 'ios';
    const theme = getAppTheme('dark', 'light');
    const { getByTestId } = render(
      <NativeDatePickerSheet visible onRequestClose={() => {}} theme={theme} testID="shared-date-picker">
        <NativeDateTimePicker value={new Date(2026, 8, 21)} mode="date" />
      </NativeDatePickerSheet>
    );

    const picker = getByTestId('native-date-time-picker');
    expect(picker.props.themeVariant).toBe('dark');
    expect(picker.props.textColor).toBe(theme.colors.text);
    expect(picker.props.accentColor).toBe(theme.colors.link);
  });
});
