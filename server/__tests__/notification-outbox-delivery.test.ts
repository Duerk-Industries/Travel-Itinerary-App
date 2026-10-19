jest.mock('../src/services/notificationWorkRepository', () => ({ putNotificationWork: jest.fn(async () => undefined) }));
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

// Unit tests for the real push/email delivery logic in notificationOutboxWorker.ts — everything
// external (the repository, Expo, email, entitlement flags) is mocked so this exercises just the
// decision logic: which channel gets tried, the no-device-registered -> email fallback, and
// disabling a dead push token vs. merely counting a transient failure.

const mockIsFeatureEnabled = jest.fn(async (_key: string) => true);
jest.mock('../src/services/entitlementService', () => ({
  isFeatureEnabled: (key: string) => mockIsFeatureEnabled(key),
}));

const mockGetPreferences = jest.fn(async () => [{ category: 'blog_mention', in_app: true, push: true, email: true }]);
const mockGetNotificationById = jest.fn();
const mockListActivePushDevicesForUser = jest.fn();
const mockDeleteDevice = jest.fn();
const mockIncrementDeviceFailure = jest.fn();
jest.mock('../src/services/notificationRepository', () => ({
  notificationRepository: () => ({
    getNotificationById: mockGetNotificationById,
    getPreferences: mockGetPreferences,
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
    id: 'notif-1', category: 'blog_mention',
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
      messages: [expect.objectContaining({ to: 'decrypted:cipher-1', title: 'Travel update', body: 'Open WanderBunnies to view this update.', data: { notificationId: 'notif-1' } })],
    });
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    expect(mockDeleteDevice).not.toHaveBeenCalled();
  });

  test('keeps no-device push work paused while the independent email outbox owns email', async () => {
    mockGetNotificationById.mockResolvedValue(notification);
    mockListActivePushDevicesForUser.mockResolvedValue([]);
    await expect(deliverPush({ notification_id: 'notif-1' })).rejects.toThrow('No consenting mobile device');
    expect(mockSendExpoPushNotifications).not.toHaveBeenCalled();
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
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

    await expect(deliverPush({ notification_id: 'notif-1' })).rejects.toThrow('PUSH_RETRY_REQUIRED');

    expect(mockDeleteDevice).toHaveBeenCalledWith('user-1', 'device-dead');
    expect(mockIncrementDeviceFailure).toHaveBeenCalledWith('device-flaky');
    expect(mockIncrementDeviceFailure).not.toHaveBeenCalledWith('device-dead');
  });

  test('pauses delivery when push is killed without sending email', async () => {
    mockIsFeatureEnabled.mockImplementation(async (key: string) => key !== 'notifications_push');
    mockGetNotificationById.mockResolvedValue(notification);
    await expect(deliverPush({ notification_id: 'notif-1' })).rejects.toThrow('paused');
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    expect(mockSendExpoPushNotifications).not.toHaveBeenCalled();
  });
  test('does not fall back to email without independent email consent', async () => {
    mockGetPreferences.mockResolvedValueOnce([{ category: 'blog_mention', in_app: true, push: true, email: false }]);
    mockGetNotificationById.mockResolvedValue(notification);
    mockListActivePushDevicesForUser.mockResolvedValue([]);
    await expect(deliverPush({ notification_id: 'notif-1' })).rejects.toThrow('No consenting mobile device');
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  test('deliverEmail is a no-op when the user has no email on file', async () => {
    mockGetNotificationById.mockResolvedValue(notification);
    mockGetUserById.mockResolvedValue({ id: 'user-1', email: null });

    await deliverEmail({ notification_id: 'notif-1' });

    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });
});
