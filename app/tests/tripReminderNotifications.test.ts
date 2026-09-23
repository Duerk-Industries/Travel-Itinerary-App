/**
 * @jest-environment jsdom
 */
import { Platform } from 'react-native';

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSchedule = jest.fn();
const mockCancel = jest.fn();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: any[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: any[]) => mockRequestPermissions(...args),
  scheduleNotificationAsync: (...args: any[]) => mockSchedule(...args),
  cancelScheduledNotificationAsync: (...args: any[]) => mockCancel(...args),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

import { ensureEveningTripReminder } from '../utils/tripReminderNotifications';

const activeTrip = { id: 'trip-1', startDate: '2026-09-20', endDate: '2026-09-25' };

describe('ensureEveningTripReminder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    (Platform as any).OS = 'ios';
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockSchedule.mockResolvedValue('notif-1');
    mockCancel.mockResolvedValue(undefined);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-22T14:00:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is a no-op on web', async () => {
    (Platform as any).OS = 'web';
    await ensureEveningTripReminder([activeTrip], activeTrip.id);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('does nothing when no trip is active today', async () => {
    await ensureEveningTripReminder([{ id: 'trip-2', startDate: '2026-01-01', endDate: '2026-01-05' }], null);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('schedules a 9pm reminder for the active trip', async () => {
    await ensureEveningTripReminder([activeTrip], activeTrip.id);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.content.data).toEqual({ type: 'evening_trip_reminder', tripId: 'trip-1' });
    expect(call.trigger.type).toBe('date');
    expect(call.trigger.date.getHours()).toBe(21);
  });

  it('does not schedule twice for the same day', async () => {
    await ensureEveningTripReminder([activeTrip], activeTrip.id);
    await ensureEveningTripReminder([activeTrip], activeTrip.id);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('does not schedule once it is already past 9pm', async () => {
    jest.setSystemTime(new Date('2026-09-22T21:30:00'));
    await ensureEveningTripReminder([activeTrip], activeTrip.id);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('does not schedule when notification permission is denied', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    await ensureEveningTripReminder([activeTrip], activeTrip.id);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('cancels a stale reminder from a previous day and reschedules for the new one', async () => {
    await ensureEveningTripReminder([activeTrip], activeTrip.id);
    expect(mockSchedule).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-09-23T14:00:00'));
    await ensureEveningTripReminder([activeTrip], activeTrip.id);
    expect(mockCancel).toHaveBeenCalledWith('notif-1');
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });
});
