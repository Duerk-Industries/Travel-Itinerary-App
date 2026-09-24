import { Platform } from 'react-native';

const mockSetChannel = jest.fn();
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: (...args: any[]) => mockSetChannel(...args),
  getPermissionsAsync: (...args: any[]) => mockGetPermissions(...args),
  requestPermissionsAsync: (...args: any[]) => mockRequestPermissions(...args),
  getExpoPushTokenAsync: (...args: any[]) => mockGetToken(...args),
  AndroidImportance: { DEFAULT: 3 },
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'test-project-id' }, backendUrl: 'https://example.test' } },
}));

const mockFetch = jest.fn();

import { registerForPushNotificationsAsync } from '../utils/pushNotifications';

describe('registerForPushNotificationsAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true });
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[test-device]' });
    (Platform as any).OS = 'ios';
  });

  test('is a no-op on web', async () => {
    (Platform as any).OS = 'web';
    await registerForPushNotificationsAsync('token-abc');
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('is a no-op with no auth token', async () => {
    await registerForPushNotificationsAsync(null);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  test('registers an android notification channel only on android', async () => {
    (Platform as any).OS = 'android';
    await registerForPushNotificationsAsync('token-abc');
    expect(mockSetChannel).toHaveBeenCalledWith('default', expect.objectContaining({ name: 'default' }));
  });

  test('requests permission only when not already granted', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    await registerForPushNotificationsAsync('token-abc');
    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  test('does not fetch a token or register when permission is denied', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });
    await registerForPushNotificationsAsync('token-abc');
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('posts the Expo push token to /api/notifications/devices with the auth header', async () => {
    await registerForPushNotificationsAsync('token-abc');

    expect(mockGetToken).toHaveBeenCalledWith({ projectId: 'test-project-id' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.test/api/notifications/devices',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc', 'Content-Type': 'application/json' }),
      })
    );
    const body = JSON.parse((mockFetch.mock.calls[0][1] as any).body);
    expect(body).toEqual(expect.objectContaining({ platform: 'ios', pushToken: 'ExponentPushToken[test-device]' }));
  });

  test('never throws when the Expo API call fails', async () => {
    mockGetToken.mockRejectedValue(new Error('network down'));
    await expect(registerForPushNotificationsAsync('token-abc')).resolves.toBeUndefined();
  });

  test('skips registration when no EAS project id is configured', async () => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({ expoConfig: { extra: {} } }));
    jest.doMock('expo-notifications', () => ({
      setNotificationChannelAsync: mockSetChannel,
      getPermissionsAsync: mockGetPermissions,
      requestPermissionsAsync: mockRequestPermissions,
      getExpoPushTokenAsync: mockGetToken,
      AndroidImportance: { DEFAULT: 3 },
    }));
    const { registerForPushNotificationsAsync: registerWithoutProject } = await import('../utils/pushNotifications');
    await registerWithoutProject('token-abc');
    expect(mockGetToken).not.toHaveBeenCalled();
  });
});
