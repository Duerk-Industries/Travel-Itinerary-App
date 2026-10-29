/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { ActivityTab, fetchActivitySuggestions, type ActivitySuggestion } from '../tabs/activities';

const styles = {
  card: {}, sectionHeaderRow: {}, sectionTitle: {}, button: {}, roundButton: {}, buttonText: {}, tableScroll: {}, tableScrollContent: {},
  table: {}, tableRow: {}, tableHeader: {}, cell: {}, lastCell: {}, headerText: {}, actionCell: {}, smallButton: {}, dangerButton: {},
  dangerButtonText: {}, cellText: {}, flightTitle: {}, helperText: {}, modalOverlay: {}, passengerOverlayBackdrop: {}, modalCard: {},
  modalLabel: {}, modalRow: {}, linkText: {},
};

const suggestion = (key: string, name: string, extra: Partial<ActivitySuggestion> = {}): ActivitySuggestion => ({
  key, name, city: 'Kyoto', activityType: 'Sights & Landmarks', startTime: '09:00', duration: '2h', startLocation: 'Fushimi',
  description: 'Thousands of vermilion gates.', image: { url: 'https://upload.wikimedia.org/x.jpg', credit: 'Someone, public domain' },
  bookAhead: false, dates: ['2027-04-07', '2027-04-08'], ...extra,
});

const renderTab = (props: Record<string, unknown> = {}) => render(
  <ActivityTab
    backendUrl="http://localhost"
    userToken="token"
    activeTripId="trip-1"
    tours={[]}
    setTours={jest.fn()}
    defaultPayerId="member-1"
    payerName={() => 'Bryan Traveler'}
    formatMemberName={(member) => `${member.firstName} ${member.lastName}`}
    groupMembers={[{ id: 'member-1', firstName: 'Bryan', lastName: 'Traveler', email: 'b@example.com', status: 'active' as const }]}
    jsonHeaders={{}}
    payerTotals={{}}
    toursTotal={0}
    styles={styles as any}
    fetchTours={jest.fn().mockResolvedValue(undefined)}
    showSuggestions
    {...props}
  />
);

const mockSuggestions = (suggestions: ActivitySuggestion[], dismissedCount = 0) => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions, dismissedCount }) });
};

describe('activity suggestions', () => {
  const originalFetch = (global as any).fetch;
  afterEach(() => { (global as any).fetch = originalFetch; });

  test('fetchActivitySuggestions returns nothing on a failed or missing response', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false });
    expect(await fetchActivitySuggestions({ backendUrl: 'http://x', activeTripId: 't', token: 'k' })).toEqual({ suggestions: [], dismissedCount: 0, activityMedia: {} });
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await fetchActivitySuggestions({ backendUrl: 'http://x', activeTripId: 't', token: 'k' })).toEqual({ suggestions: [], dismissedCount: 0, activityMedia: {} });
    expect(await fetchActivitySuggestions({ backendUrl: 'http://x', activeTripId: null, token: 'k' })).toEqual({ suggestions: [], dismissedCount: 0, activityMedia: {} });
  });

  test('asks for one day when given a date, and passes along the optional-activity pictures', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ suggestions: [], dismissedCount: 0, activityMedia: { 'act-1': { description: 'A shrine.', image: null } } }) });
    const found = await fetchActivitySuggestions({ backendUrl: 'http://x', activeTripId: 't', token: 'k', date: '2027-05-04' });
    expect(((global as any).fetch as jest.Mock).mock.calls[0][0]).toBe('http://x/api/trip-templates/trips/t/activity-suggestions?date=2027-05-04');
    expect(found.activityMedia['act-1'].description).toBe('A shrine.');
    await fetchActivitySuggestions({ backendUrl: 'http://x', activeTripId: 't', token: 'k', date: 'unscheduled-1' });
    expect(((global as any).fetch as jest.Mock).mock.calls[1][0]).toBe('http://x/api/trip-templates/trips/t/activity-suggestions');
  });

  test('lists suggestions, and Add as optional opens the editor with no date', async () => {
    mockSuggestions([suggestion('japan/fushimi-inari', 'Fushimi Inari Shrine')]);
    const { findByTestId, getByTestId, getByText } = renderTab();
    expect(await findByTestId('activity-suggestion-japan/fushimi-inari')).toBeTruthy();
    expect(getByText('Fushimi Inari Shrine')).toBeTruthy();
    expect(getByText(/Photo: Someone, public domain/)).toBeTruthy();

    fireEvent.press(getByTestId('activity-suggestion-optional-japan/fushimi-inari'));
    expect(getByTestId('activity-form-modal')).toBeTruthy();
    expect(getByText('Thousands of vermilion gates.')).toBeTruthy();
  });

  test('lists the sentence, and opens the editor with the paragraph as the notes when the stop has one', async () => {
    mockSuggestions([suggestion('a', 'First place', { details: 'A longer paragraph about the gates, their history and how to visit them.' })]);
    const { findByTestId, getByTestId, getByText, queryByText, getByPlaceholderText } = renderTab();
    await findByTestId('activity-suggestion-a');
    expect(getByText('Thousands of vermilion gates.')).toBeTruthy();
    expect(queryByText(/longer paragraph/)).toBeNull();
    fireEvent.press(getByTestId('activity-suggestion-optional-a'));
    expect(getByPlaceholderText('Description').props.value).toBe('A longer paragraph about the gates, their history and how to visit them.');
  });

  test('Add to a day opens the editor, and Dismiss removes the suggestion', async () => {
    mockSuggestions([suggestion('a', 'First place'), suggestion('b', 'Second place')]);
    const { findByTestId, getByTestId, queryByTestId } = renderTab();
    await findByTestId('activity-suggestion-a');
    fireEvent.press(getByTestId('activity-suggestion-dismiss-a'));
    await waitFor(() => expect(queryByTestId('activity-suggestion-a')).toBeNull());
    expect(within(getByTestId('activity-suggestion-add-b')).getByText('Add to specific day')).toBeTruthy();
    fireEvent.press(getByTestId('activity-suggestion-add-b'));
    expect(getByTestId('activity-form-modal')).toBeTruthy();
  });

  test('saves a dismissal for the traveler, and can bring dismissed suggestions back', async () => {
    mockSuggestions([suggestion('a', 'First place')]);
    const { findByTestId, getByTestId, queryByTestId } = renderTab();
    await findByTestId('activity-suggestion-a');
    fireEvent.press(getByTestId('activity-suggestion-dismiss-a'));
    await waitFor(() => expect(queryByTestId('activity-suggestion-a')).toBeNull());
    const post = ((global as any).fetch as jest.Mock).mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post[0]).toContain('/api/trip-templates/trips/trip-1/activity-suggestions/dismissals');
    expect(JSON.parse(post[1].body)).toEqual({ key: 'a' });

    // The count survives, and bringing them back asks the server again.
    expect(getByTestId('activity-suggestions-restore')).toBeTruthy();
    fireEvent.press(getByTestId('activity-suggestions-restore'));
    await waitFor(() => expect(((global as any).fetch as jest.Mock).mock.calls.some((call) => call[1]?.method === 'DELETE')).toBe(true));
  });

  test('shows four and lets the traveler reveal the rest', async () => {
    mockSuggestions(['a', 'b', 'c', 'd', 'e', 'f'].map((key) => suggestion(key, `Place ${key}`)));
    const { findByTestId, getByTestId, queryByTestId } = renderTab();
    await findByTestId('activity-suggestion-a');
    expect(queryByTestId('activity-suggestion-e')).toBeNull();
    fireEvent.press(getByTestId('activity-suggestions-toggle'));
    expect(getByTestId('activity-suggestion-f')).toBeTruthy();
  });

  test('offers nothing, and asks for nothing, for a read-only trip, the wizard, or a page that did not ask', async () => {
    mockSuggestions([suggestion('a', 'First place')]);
    const readOnly = renderTab({ readOnly: true });
    const wizard = renderTab({ mode: 'wizard' });
    const notAsked = renderTab({ showSuggestions: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readOnly.queryByTestId('activity-suggestions')).toBeNull();
    expect(wizard.queryByTestId('activity-suggestions')).toBeNull();
    expect(notAsked.queryByTestId('activity-suggestions')).toBeNull();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
