/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import ActivityEditForm from '../components/ActivityEditForm';
import { createInitialActivityState, type TourDraft } from '../tabs/activities';

const styles = new Proxy({}, { get: () => ({}) }) as Record<string, any>;

const renderForm = (draft: Partial<TourDraft> = {}) => {
  let current: TourDraft = { ...createInitialActivityState('2027-05-10'), ...draft };
  const onChange = jest.fn((updater: (prev: TourDraft) => TourDraft) => { current = updater(current); });
  const ui = render(<ActivityEditForm draft={current} onChange={onChange} onSave={jest.fn()} onCancel={jest.fn()} isNew members={[]} styles={styles} />);
  return { ...ui, draft: () => current };
};

describe('ActivityEditForm', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  it('picks the status and activity type from a centered list', () => {
    const { getByTestId, draft } = renderForm();
    fireEvent.press(getByTestId('activity-type').findByProps({ accessibilityRole: 'button' }));
    fireEvent.press(getByTestId('activity-type-option-Day Trip'));
    expect(draft().activityType).toBe('Day Trip');
    fireEvent.press(getByTestId('activity-status').findByProps({ accessibilityRole: 'button' }));
    fireEvent.press(getByTestId('activity-status-option-Needs Booking'));
    expect(draft().status).toBe('Needs Booking');
  });

  it("uses the same centered list on web, not the browser's own dropdown", () => {
    Platform.OS = 'web';
    const { getByTestId, UNSAFE_queryAllByType } = renderForm();
    const browserDropdowns = UNSAFE_queryAllByType('select' as never).map((select) => select.props.title);
    expect(browserDropdowns).not.toContain('Status');
    expect(browserDropdowns).not.toContain('Activity type');
    fireEvent.press(getByTestId('activity-type').findByProps({ accessibilityRole: 'button' }));
    expect(getByTestId('activity-type-options')).toBeTruthy();
  });

  it('offers Clear beside the free cancellation date only once a date is set', () => {
    expect(renderForm({ freeCancelBy: '' }).queryByTestId('activity-free-cancellation-clear')).toBeNull();
    const { getByTestId, draft } = renderForm({ freeCancelBy: '2027-05-01' });
    fireEvent.press(getByTestId('activity-free-cancellation-clear'));
    expect(draft().freeCancelBy).toBe('');
  });

  it('greys the example text in empty fields', () => {
    const { getByPlaceholderText } = renderForm();
    const color = getByPlaceholderText('Viator, GetYourGuide, Klook, etc.').props.placeholderTextColor;
    expect(color).toBeTruthy();
    expect(getByPlaceholderText('Reference').props.placeholderTextColor).toBe(color);
    expect(getByPlaceholderText('Activity name').props.placeholderTextColor).toBe(color);
  });
});
