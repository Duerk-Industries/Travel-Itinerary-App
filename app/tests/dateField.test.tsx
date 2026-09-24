/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { act, render, fireEvent } from '@testing-library/react-native';
import { Platform } from 'react-native';
import DateField from '../components/DateField';
import { getAppTheme } from '../theme/theme';

const styles = { input: { padding: 8 }, cellText: {}, buttonDisabled: { opacity: 0.5 } };

describe('DateField', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  it('renders a native <input type="date"> on web and forwards normalized changes', () => {
    Platform.OS = 'web';
    const onChange = jest.fn();
    const { getByTestId } = render(
      <DateField value="2026-11-10" onChange={onChange} styles={styles} testID="trip-start-date" />
    );
    const input = getByTestId('trip-start-date') as any;
    expect(input.props.type).toBe('date');
    expect(input.props.value).toBe('2026-11-10');
    fireEvent(input, 'change', { target: { value: '2026-12-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-12-01');
  });

  it('forwards date bounds to the web control', () => {
    Platform.OS = 'web';
    const { getByTestId } = render(
      <DateField
        value="2026-11-10"
        onChange={() => {}}
        minDate="2026-11-01"
        maxDate="2026-11-30"
        styles={styles}
        testID="bounded-date"
      />
    );

    expect((getByTestId('bounded-date') as any).props.min).toBe('2026-11-01');
    expect((getByTestId('bounded-date') as any).props.max).toBe('2026-11-30');
  });

  it('shows the placeholder when empty on web', () => {
    Platform.OS = 'web';
    const { getByTestId } = render(
      <DateField value="" onChange={() => {}} styles={styles} placeholder="Pick a date" testID="empty-date" />
    );
    expect((getByTestId('empty-date') as any).props.value).toBe('');
  });

  it('on native, shows the current value as a tappable field and opens a picker sheet with Cancel/Done', () => {
    Platform.OS = 'ios';
    const onChange = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <DateField value="2026-11-10" onChange={onChange} styles={styles} testID="trip-start-date" />
    );
    expect(getByTestId('trip-start-date')).toBeTruthy();
    expect(queryByTestId('trip-start-date-done')).toBeNull();
    fireEvent.press(getByTestId('trip-start-date'));
    expect(getByTestId('trip-start-date-done')).toBeTruthy();
    expect(getByTestId('trip-start-date-cancel')).toBeTruthy();
  });

  it('on native, Cancel dismisses the sheet without calling onChange', () => {
    Platform.OS = 'ios';
    const onChange = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <DateField value="2026-11-10" onChange={onChange} styles={styles} testID="trip-start-date" />
    );
    fireEvent.press(getByTestId('trip-start-date'));
    fireEvent.press(getByTestId('trip-start-date-cancel'));
    expect(onChange).not.toHaveBeenCalled();
    expect(queryByTestId('trip-start-date-done')).toBeNull();
  });

  it('on iOS, uses the spinner sheet and waits for Done before committing the selected local date', () => {
    Platform.OS = 'ios';
    const onChange = jest.fn();
    const { getByTestId } = render(
      <DateField value="2026-11-10" onChange={onChange} styles={styles} testID="trip-start-date" />
    );
    fireEvent.press(getByTestId('trip-start-date'));

    const picker = getByTestId('native-date-time-picker');
    expect(picker.props.display).toBe('spinner');
    act(() => {
      picker.props.onValueChange({ nativeEvent: {} }, new Date(2026, 10, 12));
    });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('trip-start-date-done'));
    expect(onChange).toHaveBeenCalledWith('2026-11-12');
  });

  it.each([
    ['light', getAppTheme('light', 'dark')],
    ['dark', getAppTheme('dark', 'light')],
  ] as const)('matches the %s app appearance for iOS picker text', (_mode, theme) => {
    Platform.OS = 'ios';
    const { getByTestId } = render(
      <DateField value="2026-11-10" onChange={() => {}} styles={styles} theme={theme} testID="themed-date" />
    );

    fireEvent.press(getByTestId('themed-date'));
    const picker = getByTestId('native-date-time-picker');
    expect(picker.props.themeVariant).toBe(theme.mode);
    expect(picker.props.textColor).toBe(theme.colors.text);
    expect(picker.props.accentColor).toBe(theme.colors.link);
  });

  it('on Android, commits immediately and dismisses after selection', () => {
    Platform.OS = 'android';
    const onChange = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <DateField value="2026-11-10" onChange={onChange} styles={styles} testID="trip-start-date" />
    );
    fireEvent.press(getByTestId('trip-start-date'));

    act(() => {
      getByTestId('native-date-time-picker').props.onValueChange(
        { nativeEvent: {} },
        new Date(2026, 10, 13),
      );
    });

    expect(onChange).toHaveBeenCalledWith('2026-11-13');
    expect(queryByTestId('trip-start-date-done')).toBeNull();
  });

  it('disabled prevents opening the picker', () => {
    Platform.OS = 'ios';
    const { getByTestId, queryByTestId } = render(
      <DateField value="2026-11-10" onChange={() => {}} styles={styles} testID="trip-start-date" disabled />
    );
    fireEvent.press(getByTestId('trip-start-date'));
    expect(queryByTestId('trip-start-date-done')).toBeNull();
  });
  it('in time mode, renders <input type="time"> on web with the app color-scheme', () => {
    Platform.OS = 'web';
    const onChange = jest.fn();
    const { getByTestId } = render(
      <DateField mode="time" value="08:15" onChange={onChange} styles={styles} theme={getAppTheme('dark', 'light')} testID="dep-time" />
    );
    const input = getByTestId('dep-time') as any;
    expect(input.props.type).toBe('time');
    expect(input.props.style.colorScheme).toBe('dark');
    fireEvent(input, 'change', { target: { value: '09:45' } });
    expect(onChange).toHaveBeenCalledWith('09:45');
  });

  it('lets a caller style width override the full-width web default', () => {
    Platform.OS = 'web';
    const { getByTestId } = render(
      <DateField value="" onChange={() => {}} styles={styles} style={{ width: 120 }} testID="grid-date" />
    );
    expect((getByTestId('grid-date') as any).props.style.width).toBe(120);
  });

  it('in time mode on iOS, opens a time wheel and commits HH:MM on Done', () => {
    Platform.OS = 'ios';
    const onChange = jest.fn();
    const { getByTestId } = render(
      <DateField mode="time" value="08:15" onChange={onChange} styles={styles} testID="dep-time" />
    );
    fireEvent.press(getByTestId('dep-time'));
    const picker = getByTestId('native-date-time-picker');
    expect(picker.props.mode).toBe('time');
    expect(picker.props.value.getHours()).toBe(8);
    expect(picker.props.value.getMinutes()).toBe(15);
    act(() => {
      picker.props.onValueChange({ nativeEvent: {} }, new Date(2026, 0, 1, 21, 5));
    });
    fireEvent.press(getByTestId('dep-time-done'));
    expect(onChange).toHaveBeenCalledWith('21:05');
  });

  it('on Android, renders the OS picker dialog bare with no sheet chrome', () => {
    Platform.OS = 'android';
    const { getByTestId, queryByTestId } = render(
      <DateField value="2026-11-10" onChange={() => {}} styles={styles} testID="trip-start-date" />
    );
    fireEvent.press(getByTestId('trip-start-date'));
    expect(getByTestId('native-date-time-picker')).toBeTruthy();
    expect(queryByTestId('trip-start-date-done')).toBeNull();
    expect(queryByTestId('trip-start-date-cancel')).toBeNull();
  });

  it('calls onOpen before showing the picker so callers can seed defaults', () => {
    Platform.OS = 'ios';
    const onOpen = jest.fn();
    const { getByTestId } = render(
      <DateField value="" onChange={() => {}} styles={styles} onOpen={onOpen} testID="trip-start-date" />
    );
    fireEvent.press(getByTestId('trip-start-date'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
