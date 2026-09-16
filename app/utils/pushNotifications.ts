/**
 * Registers this device for real push delivery (server/src/apis/expoPushApi.ts,
 * notificationOutboxWorker.ts) by requesting notification permission, fetching an Expo push
 * token, and POSTing it to /api/notifications/devices.
 *
 * Native only (iOS/Android). Web has no Expo push token to register — per the product decision
 * for real push delivery, web/no-device users are reached by email instead (see
 * notifications_email in server/config/feature-flags.yaml), so this is a deliberate no-op on web
 * rather than a gap to fill in later.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { resolveBackendUrl } from './backendUrl';

// Best-effort throughout: a permission denial, a missing EAS project id, or a network hiccup here
// must never block login or crash the app — push registration is a nice-to-have layered on top of
// a session that already works without it.
export const registerForPushNotificationsAsync = async (authToken: string | null): Promise<void> => {
  if (Platform.OS === 'web' || !authToken) return;

  try {
    const Notifications = await import('expo-notifications');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return;

    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
    if (!projectId) return;

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const pushToken = tokenResponse.data;
    if (!pushToken) return;

    const backendUrl = resolveBackendUrl({
      appConfigured: (Constants.expoConfig?.extra as any)?.backendUrl,
      envConfigured:
        (typeof process !== 'undefined' &&
          (process.env.EXPO_PUBLIC_BACKEND_URL ??
            process.env.BACKEND_URL ??
            process.env.WEB_URL ??
            process.env.API_BASE_URL ??
            process.env.REACT_APP_BACKEND_URL ??
            process.env.REACT_NATIVE_APP_BACKEND_URL)) ||
        '',
      nodeEnv: typeof process !== 'undefined' ? process.env.NODE_ENV : undefined,
      platformOs: Platform.OS,
    });

    await fetch(`${backendUrl}/api/notifications/devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        platform: Platform.OS,
        pushToken,
        deviceLabel: `${Platform.OS} ${Platform.Version ?? ''}`.trim(),
      }),
    });
  } catch {
    // Swallowed deliberately — see the best-effort note above. Nothing here is worth surfacing to
    // the user; a failed registration just means this device falls back to no real-time delivery
    // until the next successful login retries it.
  }
};
