import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationInbox from '../components/NotificationInbox';

jest.mock('../utils/socket', () => ({ getSocket: () => ({ on: jest.fn(), off: jest.fn() }) }));
jest.mock('../utils/pushNotifications', () => ({ registerForPushNotificationsAsync: jest.fn(async () => true) }));
it('saves a local digest time without changing channel consent', async () => {
  const original = global.fetch;
  const fetcher = jest.fn(async (url: RequestInfo | URL, options?: RequestInit) => ({ ok: true, json: async () =>
    String(url).includes('/preferences') && !options?.method
      ? { preferences: [{ userId: 'owner', category: 'trip_digest', inApp: true, push: false, email: false }] }
      : { notifications: [], unreadCount: 0, nextCursor: null } }) as Response);
  global.fetch = fetcher;
  try {
    const screen = render(<NotificationInbox backendUrl="https://api.test" token="owner-token" onOpen={jest.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Notifications, 0 unread')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Notifications, 0 unread'));
    fireEvent.press(screen.getByText('Alert settings'));
    await waitFor(() => expect(screen.getByText('Set daily summary time')).toBeTruthy());
    fireEvent.press(screen.getByText('Set daily summary time'));
    fireEvent.changeText(screen.getByLabelText('Daily summary timezone'), 'America/New_York');
    fireEvent.changeText(screen.getByLabelText('Daily summary time, 24 hour time'), '09:30');
    fireEvent.press(screen.getByText('Save summary time'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('https://api.test/api/notifications/preferences', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ preferences: [{ category: 'trip_digest', inApp: true, push: false, email: false, digestTiming: { timezone: 'America/New_York', time: '09:30' } }] }) })));
  } finally { global.fetch = original; }
});
