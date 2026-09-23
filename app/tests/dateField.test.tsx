/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Platform } from 'react-native';
import DateField from '../components/DateField';

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

  it('disabled prevents opening the picker', () => {
    Platform.OS = 'ios';
    const { getByTestId, queryByTestId } = render(
      <DateField value="2026-11-10" onChange={() => {}} styles={styles} testID="trip-start-date" disabled />
    );
    fireEvent.press(getByTestId('trip-start-date'));
    expect(queryByTestId('trip-start-date-done')).toBeNull();
  });
});
