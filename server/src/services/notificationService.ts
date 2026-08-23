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
}

const DEFAULT_PREFERENCES: Record<string, { inApp: boolean; push: boolean; email: boolean }> = {
  blog_mention: { inApp: true, push: true, email: false },
  blog_comment_reply: { inApp: true, push: true, email: false },
  blog_nudge: { inApp: true, push: false, email: false },
  blog_reaction_digest: { inApp: true, push: false, email: false },
  blog_memory_lane: { inApp: true, push: false, email: false },
  blog_milestone: { inApp: true, push: false, email: false },
};

export const notify = async (options: NotifyOptions): Promise<void> => {
  const { userIds, category, threadKey } = options;
  if (!userIds.length) return;

  try {
    const preferences = await notificationRepository().getPreferences(userIds);
    const prefMap = new Map(preferences.map((p) => [p.user_id, p]));

    for (const userId of userIds) {
      if (threadKey && await notificationRepository().isThreadMuted(userId, threadKey)) continue;

      const userPref = prefMap.get(userId) || DEFAULT_PREFERENCES[category] || { inApp: true, push: false, email: false };

      let notificationId: string | null = null;
      if (userPref.in_app !== false) {
        notificationId = await notificationRepository().createNotification({
          userId,
          category,
          tripId: options.tripId,
          actorUserId: options.actorUserId,
          title: options.title,
          body: options.body,
          deepLink: options.deepLink,
          payload: options.payload,
          dedupeKey: options.dedupeKey,
        });
      }

      if (notificationId) {
        const outboxEntries: any[] = [];
        if (userPref.push) outboxEntries.push({ notificationId, channel: 'push' });
        if (userPref.email) outboxEntries.push({ notificationId, channel: 'email' });

        if (outboxEntries.length) {
          await notificationRepository().enqueueOutbox(outboxEntries);
        }
      }
    }
  } catch (err) {
    logError('[notification-service] failed to dispatch notifications', err);
  }
};
