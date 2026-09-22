// Evening trip reminder: a local (on-device) notification, scheduled for 9pm device-local time on
// any day the traveler is on an active trip, nudging them to add photos/blog entries before the
// day wraps up. Deliberately client-side, not server push — the server has no per-user timezone
// storage and no time-of-day scheduler, while a local notification trivially uses the phone's own
// clock. Accepted limitation: it only arms if the app is opened at least once that day before 9pm.
import { Platform } from 'react-native';
import { isTripActiveToday, localDateString } from './offlineTripCache';
import { readAsync, writeAsync } from './persistentStorage';

const STORAGE_KEY = 'stp.eveningTripReminder';
const REMINDER_HOUR = 21; // 9pm local time

type ScheduledReminder = { dateKey: string; notificationId: string };

const readScheduled = async (): Promise<ScheduledReminder | null> => {
  try {
    const raw = await readAsync(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.dateKey && parsed?.notificationId ? parsed : null;
  } catch {
    return null;
  }
};

const writeScheduled = async (value: ScheduledReminder | null): Promise<void> => {
  if (!value) return writeAsync(STORAGE_KEY, '');
  return writeAsync(STORAGE_KEY, JSON.stringify(value));
};

// Native-only (matches the existing push-registration scoping in pushNotifications.ts) — best
// effort throughout, same rationale as that file: a permission denial, a missing native module, or
// a scheduling hiccup here must never crash the app or block anything else.
export const ensureEveningTripReminder = async (trips: Array<{ id: string; startDate?: string | null; endDate?: string | null }>, activeTripId: string | null): Promise<void> => {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    const now = new Date();
    const today = localDateString(now);
    const activeTrip = trips.find((trip) => isTripActiveToday(trip, now));

    const scheduled = await readScheduled();
    if (scheduled && scheduled.dateKey !== today) {
      await Notifications.cancelScheduledNotificationAsync(scheduled.notificationId).catch(() => {});
      await writeScheduled(null);
    }
    if (!activeTrip) return;
    if (scheduled?.dateKey === today) return; // already armed for today
    if (now.getHours() >= REMINDER_HOUR) return; // too late to usefully arm today

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return;

    const triggerDate = new Date(now);
    triggerDate.setHours(REMINDER_HOUR, 0, 0, 0);

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'How was today?',
        body: "Add today's photos and a quick note before the day wraps up.",
        data: { type: 'evening_trip_reminder', tripId: activeTrip.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
    await writeScheduled({ dateKey: today, notificationId });
  } catch {
    // Best effort — see the file-level note above.
  }
};

// Registered once at app startup (native only) so a foreground notification still displays, and so
// tapping one is observable via the response listener App.tsx attaches separately.
export const configureEveningTripReminderHandler = async (): Promise<void> => {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // Best effort — see the file-level note above.
  }
};
