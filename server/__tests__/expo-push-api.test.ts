import { describe, expect, test, jest, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.mock('axios', () => ({ post: (...args: any[]) => mockPost(...args) }));

const mockReserve = jest.fn(async () => {});
const mockRecordCost = jest.fn(async () => {});
jest.mock('../src/apis/usageLimiter', () => ({ reserveApiUsageOrThrow: (...args: any[]) => mockReserve(...args) }));
jest.mock('../src/apis/providerBudgeting', () => ({ recordProviderRequestCost: (...args: any[]) => mockRecordCost(...args) }));

import { sendExpoPushNotifications, isValidExpoPushToken } from '../src/apis/expoPushApi';

describe('expoPushApi', () => {
  beforeEach(() => jest.clearAllMocks());

  test('isValidExpoPushToken accepts Expo/Exponent token shapes and rejects everything else', () => {
    expect(isValidExpoPushToken('ExponentPushToken[abc123]')).toBe(true);
    expect(isValidExpoPushToken('ExpoPushToken[abc123]')).toBe(true);
    expect(isValidExpoPushToken('not-a-real-token')).toBe(false);
    expect(isValidExpoPushToken('')).toBe(false);
  });

  test('skips the API call entirely when every token is invalid', async () => {
    const result = await sendExpoPushNotifications({ caller: 'NOTIFICATION_PUSH', messages: [{ to: 'garbage', body: 'hi' }] });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockReserve).not.toHaveBeenCalled();
    expect(result.tickets).toEqual([null]);
  });

  test('sends only valid tokens and realigns tickets back to the original message order', async () => {
    mockPost.mockResolvedValue({ data: { data: [{ status: 'ok', id: 'ticket-1' }] } });

    const result = await sendExpoPushNotifications({
      caller: 'NOTIFICATION_PUSH',
      messages: [
        { to: 'garbage-token', body: 'skipped' },
        { to: 'ExponentPushToken[valid]', body: 'sent' },
      ],
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [, body] = mockPost.mock.calls[0];
    expect(body).toEqual([{ to: 'ExponentPushToken[valid]', body: 'sent' }]);
    expect(result.tickets).toEqual([null, { status: 'ok', id: 'ticket-1' }]);
    expect(mockReserve).toHaveBeenCalledWith({ provider: 'EXPO_PUSH', caller: 'NOTIFICATION_PUSH' });
  });

  test('a failed batch produces error tickets instead of throwing, without dropping message count', async () => {
    mockPost.mockRejectedValue(new Error('network blip'));

    const result = await sendExpoPushNotifications({
      caller: 'NOTIFICATION_PUSH',
      messages: [{ to: 'ExponentPushToken[a]', body: '1' }, { to: 'ExponentPushToken[b]', body: '2' }],
    });

    expect(result.tickets).toHaveLength(2);
    expect(result.tickets.every((t) => t?.status === 'error')).toBe(true);
  });
});
