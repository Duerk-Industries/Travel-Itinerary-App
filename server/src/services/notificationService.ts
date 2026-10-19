import { getIo } from '../socket';
import { notificationRepository } from './notificationRepository';
import { NotificationCategory } from './notificationTypes';
import { logError } from '../logger';

export interface NotifyOptions {
  userIds: string[];
  category: NotificationCategory;
  tripId?: string | null;
  actorUserId?: string | null;
  title: string;
  body: string;
  deepLink?: string | null;
  payload?: Record<string, any>;
  dedupeKey?: string | null;
  threadKey?: string | null;
  requireDurable?: boolean;
}

export const DEFAULT_PREFERENCES: Record<string, { inApp: boolean; push: boolean; email: boolean }> = {
  import_result: { inApp: true, push: false, email: false },
  cancellation_deadline: { inApp: true, push: false, email: false },
  ai_finished: { inApp: true, push: false, email: false },
  trip_digest: { inApp: false, push: false, email: false },
  blog_mention: { inApp: true, push: true, email: false },
  blog_comment_reply: { inApp: true, push: true, email: false },
  blog_nudge: { inApp: true, push: false, email: false },
  blog_reaction_digest: { inApp: true, push: false, email: false },
  blog_memory_lane: { inApp: true, push: false, email: false },
  blog_milestone: { inApp: true, push: false, email: false },
  // End-of-day nudge — unlike every other category above, this one defaults fully off on every
  // channel. It's opt-in by design, on top of the separate trip-level
  // trip_blogs.day_photo_reminders_enabled gate (blogBackgroundWorker.ts's
  // runDayPhotoReminderJob): a traveler must explicitly set a preference (PATCH
  // /api/notifications/preferences) before this category ever reaches them at all.
  blog_day_photo_reminder: { inApp: false, push: false, email: false },
  activity_recap: { inApp: true, push: true, email: false },
};

export const notify = async (options: NotifyOptions): Promise<void> => {
  const { userIds, category, threadKey } = options;
  if (!userIds.length) return;

  try {
    const preferences = await notificationRepository().getPreferences(userIds);
    // Preferences are per user *and* category. Keying only by user meant whichever row happened
    // to be returned first controlled every notification type, including the new activity recap.
    const prefMap = new Map(preferences.map((p) => [`${p.user_id ?? p.userId}:${p.category}`, p]));

    for (const userId of userIds) {
      if (threadKey && await notificationRepository().isThreadMuted(userId, threadKey)) continue;

      const userPref = prefMap.get(`${userId}:${category}`) || DEFAULT_PREFERENCES[category] || { inApp: true, push: false, email: false };
      // A stored preference row (getPreferences) is a raw DB row (snake_case, in_app); the
      // in-code DEFAULT_PREFERENCES fallback is camelCase (inApp) — normalized here rather than
      // reading userPref.in_app directly, which would silently ignore the default object's own
      // field and always fall through to "enabled" regardless of what the default actually says.
      const inAppEnabled = userPref.in_app ?? userPref.inApp ?? true;

      // Independent channel consent: email-only users still need a durable
      // delivery row; it is excluded from inbox history/counts.
      if (inAppEnabled === false && !userPref.push && !userPref.email) continue;
      const channels: Array<'push' | 'email'> = [];
      if (userPref.push) channels.push('push');
      if (userPref.email) channels.push('email');
      await notificationRepository().createNotificationWithOutbox({
        userId, category, inApp: inAppEnabled !== false, tripId: options.tripId ?? null,
        actorUserId: options.actorUserId ?? null, title: options.title, body: options.body,
        deepLink: options.deepLink ?? null, payload: options.payload ?? {}, dedupeKey: options.dedupeKey ?? null,
      }, channels);
      getIo()?.to(`user:${userId}`).emit('notification:changed', {});
    }
  } catch (err) {
    logError('[notification-service] failed to dispatch notifications', err);
    if (options.requireDurable) throw err;
  }
};

export const getNotificationPreference = async (userId: string, category: NotificationCategory, rows?: any[]): Promise<{ inApp: boolean; push: boolean; email: boolean }> => {
  const saved = (rows ?? await notificationRepository().getPreferences([userId])).find(row => row.category === category);
  const fallback = DEFAULT_PREFERENCES[category] || { inApp: true, push: false, email: false };
  return { inApp: saved?.in_app ?? saved?.inApp ?? fallback.inApp, push: saved?.push ?? fallback.push, email: saved?.email ?? fallback.email };
};
