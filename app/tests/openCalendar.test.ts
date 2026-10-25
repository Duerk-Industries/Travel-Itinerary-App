/** @jest-environment jsdom */
import { Linking, Platform } from 'react-native';
import { makeCalendarEvent } from '../utils/calendarEvents';
import { openCalendar } from '../utils/openCalendar';
import { createEventInCalendarAsync, requestCalendarPermissionsAsync } from 'expo-calendar';

jest.mock('expo-calendar', () => ({ createEventInCalendarAsync: jest.fn(), requestCalendarPermissionsAsync: jest.fn() }));
const event = makeCalendarEvent({ id: '1', title: 'Museum', date: '2027-04-01', time: '09:00', location: 'Tokyo' })!;
const create = jest.mocked(createEventInCalendarAsync);
const permission = jest.mocked(requestCalendarPermissionsAsync);

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { Object.assign(Platform, { OS: 'ios', Version: undefined }); jest.useRealTimers(); });

it('opens Google Calendar with the event details', async () => {
  await openCalendar(event, 'google');
  const params = new URL(jest.mocked(Linking.openURL).mock.calls[0][0]).searchParams;
  expect(params.get('text')).toBe('Museum');
  expect(params.get('dates')).toBe('20270401T090000/20270401T100000');
  expect(create).not.toHaveBeenCalled();
});

it('opens the native calendar editor on iOS 17+ without requesting broad calendar access', async () => {
  Object.assign(Platform, { OS: 'ios', Version: '18.0' });
  await openCalendar(event, 'apple');
  expect(permission).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Museum', location: 'Tokyo', allDay: false,
    startDate: new Date('2027-04-01T09:00:00'), endDate: new Date('2027-04-01T10:00:00') }));
});

it('handles denied permission on older iOS without opening the editor', async () => {
  Object.assign(Platform, { OS: 'ios', Version: '16.0' });
  permission.mockResolvedValueOnce({ granted: false } as Awaited<ReturnType<typeof requestCalendarPermissionsAsync>>);
  await expect(openCalendar(event, 'apple')).rejects.toThrow('permission');
  expect(create).not.toHaveBeenCalled();
});

it('downloads a calendar file on the web and releases the object URL', async () => {
  Object.assign(Platform, { OS: 'web' });
  jest.useFakeTimers();
  const createUrl = jest.fn(() => 'blob:calendar');
  const revokeUrl = jest.fn();
  Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('wanderbunnies-event.ics');
    expect(this.href).toBe('blob:calendar');
  });
  await openCalendar(event, 'apple');
  expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector('a')).toBeNull();
  jest.runAllTimers();
  expect(revokeUrl).toHaveBeenCalledWith('blob:calendar');
  click.mockRestore();
});
