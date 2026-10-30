import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AddToCalendarButton from '../components/AddToCalendarButton';
import { CalendarPreferenceContext } from '../contexts/CalendarPreferenceContext';
import { makeCalendarEvent } from '../utils/calendarEvents';
import { openCalendar } from '../utils/openCalendar';
import TripItemDetailsDialog from '../components/TripItemDetailsDialog';

jest.mock('../utils/openCalendar', () => ({ openCalendar: jest.fn() }));
const open = jest.mocked(openCalendar);
const event = makeCalendarEvent({ id: '1', title: 'Tour', date: '2027-04-01', time: '09:00' });

it('hides the action for undated items', () => {
  expect(render(<AddToCalendarButton event={null} styles={{}} />).queryByLabelText('Add to calendar')).toBeNull();
});

it('lets a read-only trip viewer add an event without exposing trip edit actions', () => {
  const view = render(<TripItemDetailsDialog visible readOnly kind="activity" title="Tour" rows={[]} styles={{}}
    calendarEvent={event} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} />);
  expect(view.getByLabelText('Add to calendar')).toBeTruthy();
  expect(view.queryByLabelText('Edit activity')).toBeNull();
  expect(view.queryByLabelText('Delete activity')).toBeNull();
});

it('opens the preferred calendar and reports failures without claiming an event was saved', async () => {
  open.mockRejectedValueOnce(new Error('denied'));
  const view = render(<CalendarPreferenceContext.Provider value="apple"><AddToCalendarButton event={event} styles={{}} /></CalendarPreferenceContext.Provider>);
  fireEvent.press(view.getByLabelText('Add to calendar'));
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(open).toHaveBeenCalledWith(event, 'apple');
});

it('compact mode shows only the calendar icon but keeps the accessible label and action', () => {
  open.mockResolvedValueOnce(undefined as any);
  const view = render(<AddToCalendarButton event={event} styles={{}} compact />);
  expect(view.queryByText('Add to calendar')).toBeNull();
  expect(view.getByLabelText('calendar')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Add to calendar'));
  expect(open).toHaveBeenCalledWith(event, expect.anything());
});
