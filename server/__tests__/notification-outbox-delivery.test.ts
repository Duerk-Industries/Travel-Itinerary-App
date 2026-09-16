import { describe, expect, test, jest, beforeEach } from '@jest/globals';

// Unit tests for the real push/email delivery logic in notificationOutboxWorker.ts — everything
// external (the repository, Expo, email, entitlement flags) is mocked so this exercises just the
// decision logic: which channel gets tried, the no-device-registered -> email fallback, and
// disabling a dead push token vs. merely counting a transient failure.

const mockIsFeatureEnabled = jest.fn(async (_key: string) => true);
jest.mock('../src/services/entitlementService', () => ({
  isFeatureEnabled: (key: string) => mockIsFeatureEnabled(key),
}));

const mockGetNotificationById = jest.fn();
const mockListActivePushDevicesForUser = jest.fn();
const mockDeleteDevice = jest.fn();
const mockIncrementDeviceFailure = jest.fn();
jest.mock('../src/services/notificationRepository', () => ({
  notificationRepository: () => ({
    getNotificationById: mockGetNotificationById,
    listActivePushDevicesForUser: mockListActivePushDevicesForUser,
    deleteDevice: mockDeleteDevice,
    incrementDeviceFailure: mockIncrementDeviceFailure,
  }),
}));

const mockGetUserById = jest.fn();
jest.mock('../src/db', () => ({
  getUserById: (id: string) => mockGetUserById(id),
}));

const mockSendNotificationEmail = jest.fn();
jest.mock('../src/mailer', () => ({
  sendNotificationEmail: (...args: any[]) => mockSendNotificationEmail(...args),
}));

const mockSendExpoPushNotifications = jest.fn();
jest.mock('../src/apis/expoPushApi', () => ({
  sendExpoPushNotifications: (...args: any[]) => mockSendExpoPushNotifications(...args),
}));

jest.mock('../src/utils/pushTokenCrypto', () => ({
  decryptPushToken: (ciphertext: string) => `decrypted:${ciphertext}`,
}));

import { deliverPush, deliverEmail } from '../src/services/notificationOutboxWorker';

describe('notification outbox real delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsFeatureEnabled.mockResolvedValue(true);
  });

  const notification = {
    id: 'notif-1',
    user_id: 'user-1',
    title: 'Add a photo from today?',
    body: 'The day is almost over.',
    deep_link: '/trips/trip-1/blog',
  };

  test('sends a real push to every registered device', async () => {
    mockGetNotificationById.mockResolvedValue(notification);
    mockListActivePushDevicesForUser.mockResolvedValue([
      { id: 'device-1', platform: 'ios', push_token_ciphertext: 'cipher-1' },
    ]);
    mockSendExpoPushNotifications.mockResolvedValue({ tickets: [{ status: 'ok', id: 'ticket-1' }] });

    await deliverPush({ notification_id: 'notif-1' });

    expect(mockSendExpoPushNotifications).toHaveBeenCalledWith({
      caller: 'NOTIFICATION_PUSH',
      messages: [expect.objectContaining({ to: 'decrypted:cipher-1', title: notification.title, body: notification.body })],
    });
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    expect(mockDeleteDevice).not.toHaveBeenCalled();
  });

  test('falls back to email when the user has no registered push device', async () => {
    mockGetNotificationById.mockResolvedValue(notification);
    mockListActivePushDevicesForUser.mockResolvedValue([]);
    mockGetUserById.mockResolvedValue({ id: 'user-1', email: 'web-user@example.com' });

    await deliverPush({ notification_id: 'notif-1' });

    expect(mockSendExpoPushNotifications).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      'web-user@example.com',
      notification.title,
      notification.body,
      notification.deep_link
    );
  });

  test('disables a device on DeviceNotRegistered but only counts a failure otherwise', async () => {
    mockGetNotificationById.mockResolvedValue(notification);
    mockListActivePushDevicesForUser.mockResolvedValue([
      { id: 'device-dead', platform: 'ios', push_token_ciphertext: 'cipher-dead' },
      { id: 'device-flaky', platform: 'android', push_token_ciphertext: 'cipher-flaky' },
    ]);
    mockSendExpoPushNotifications.mockResolvedValue({
      tickets: [
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', details: { error: 'MessageTooBig' } },
      ],
    });

    await deliverPush({ notification_id: 'notif-1' });

    expect(mockDeleteDevice).toHaveBeenCalledWith('user-1', 'device-dead');
    expect(mockIncrementDeviceFailure).toHaveBeenCalledWith('device-flaky');
    expect(mockIncrementDeviceFailure).not.toHaveBeenCalledWith('device-dead');
  });

  test('falls back to email (not a no-op) when the notifications_push flag is off', async () => {
    // A disabled notifications_push flag must be treated the same as "no device registered" —
    // it's still a reason to try email, not a reason to skip the user entirely. See the bug this
    // guards against: notificationOutboxWorker.ts originally returned before ever reaching the
    // device check when this flag was off (its default state), silently dropping every reminder.
    mockIsFeatureEnabled.mockImplementation(async (key: string) => key !== 'notifications_push');
    mockGetNotificationById.mockResolvedValue(notification);
    mockGetUserById.mockResolvedValue({ id: 'user-1', email: 'flagoff@example.com' });

    await deliverPush({ notification_id: 'notif-1' });

    expect(mockListActivePushDevicesForUser).not.toHaveBeenCalled();
    expect(mockSendExpoPushNotifications).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      'flagoff@example.com',
      notification.title,
      notification.body,
      notification.deep_link
    );
  });

  test('deliverEmail is a no-op when the user has no email on file', async () => {
    mockGetNotificationById.mockResolvedValue(notification);
    mockGetUserById.mockResolvedValue({ id: 'user-1', email: null });

    await deliverEmail({ notification_id: 'notif-1' });

    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });
});
