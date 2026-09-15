import { randomUUID } from 'crypto';
import { notificationRepository } from './notificationRepository';
import { logError, logInfo } from '../logger';
import { getApiCacheSetting } from '../config/apiLimits';
import { isFeatureEnabled } from './entitlementService';
import { getUserById } from '../db';
import { sendNotificationEmail } from '../mailer';
import { sendExpoPushNotifications } from '../apis/expoPushApi';
import { decryptPushToken } from '../utils/pushTokenCrypto';

// Phase 4.5: Notification outbox worker.
// Durable, leased provider delivery (architecture §13.3).

const BATCH_SIZE = 50;
const LEASE_SECONDS = 60;
const TICK_MS = 5000;

export const startNotificationOutboxWorker = () => {
  const leaseOwner = `outbox-worker-${randomUUID()}`;
  setInterval(async () => {
    try {
      if (!(await isFeatureEnabled('notifications_outbox_enabled'))) return;

      const batch = await notificationRepository().claimOutboxBatch(leaseOwner, BATCH_SIZE, LEASE_SECONDS);
      if (!batch.length) return;

      logInfo(`[notification-outbox] claimed ${batch.length} entries`);

      for (const entry of batch) {
        try {
          if (entry.channel === 'push') {
            await deliverPush(entry);
          } else if (entry.channel === 'email') {
            await deliverEmail(entry);
          }
          await notificationRepository().updateOutboxState(entry.id, 'sent');
        } catch (err) {
          // entry.attempt_count (Postgres row) vs entry.attemptCount (Firestore doc) — the two
          // repositories don't share a casing convention (see notificationRepository.ts), so this
          // reads whichever one the active provider actually set.
          const attemptCount = Number(entry.attempt_count ?? entry.attemptCount ?? 0) + 1;
          const isDead = attemptCount >= 5;
          const nextAttemptAt = new Date(Date.now() + Math.pow(2, attemptCount) * 1000);
          await notificationRepository().updateOutboxState(entry.id, isDead ? 'dead' : 'pending', {
            attemptCount,
            nextAttemptAt,
            lastErrorCode: String((err as any)?.message || 'DELIVERY_FAILED').slice(0, 100),
          });
          logError(`[notification-outbox] delivery failed for entry ${entry.id}`, err);
        }
      }
    } catch (err) {
      logError('[notification-outbox] worker tick failed', err);
    }
  }, TICK_MS);
};

// Both repositories' rows are read defensively below (snake_case Postgres columns vs camelCase
// Firestore fields) for the same reason as the attemptCount read above.
const notificationIdOf = (entry: any): string => String(entry.notification_id ?? entry.notificationId ?? '');

export const deliverPush = async (entry: any) => {
  const notification = await notificationRepository().getNotificationById(notificationIdOf(entry));
  if (!notification) return; // notification since pruned/deleted — nothing left to deliver

  const userId = String(notification.user_id ?? notification.userId ?? '');
  // The notifications_push flag gates real Expo sending only, not the email fallback below — an
  // admin turning mobile push off (or it defaulting off pre-launch; see feature-flags.yaml) is a
  // reason to treat this user as device-less, not a reason to skip notifying them entirely.
  const pushEnabled = await isFeatureEnabled('notifications_push');
  const devices = pushEnabled ? await notificationRepository().listActivePushDevicesForUser(userId) : [];

  if (!devices.length) {
    // No mobile device registered for this user — most likely someone using the web app, which
    // has no push token to deliver to. Product decision: fall back to a real email so "push:true"
    // still reaches them somehow (see notifications_email's description in feature-flags.yaml).
    await deliverEmail(entry);
    return;
  }

  const title = String(notification.title ?? '');
  const body = String(notification.body ?? '');
  const deepLink = notification.deep_link ?? notification.deepLink ?? null;

  const messages = devices.map((d) => ({
    to: decryptPushToken(String(d.push_token_ciphertext ?? d.pushTokenCiphertext ?? '')),
    sound: 'default' as const,
    title,
    body,
    data: { deepLink, notificationId: notification.id },
  }));

  const { tickets } = await sendExpoPushNotifications({ caller: 'NOTIFICATION_PUSH', messages });

  await Promise.all(devices.map(async (device, index) => {
    const ticket = tickets[index];
    if (!ticket || ticket.status !== 'error') return;
    // DeviceNotRegistered means the OS has revoked this token (app uninstalled, etc.) — it will
    // never succeed again, so disable it outright rather than letting failure_count creep up on a
    // token that's permanently dead.
    if ((ticket as any).details?.error === 'DeviceNotRegistered') {
      await notificationRepository().deleteDevice(userId, device.id);
    } else {
      await notificationRepository().incrementDeviceFailure(device.id);
    }
  }));
};

export const deliverEmail = async (entry: any) => {
  if (!(await isFeatureEnabled('notifications_email'))) return;

  const notification = await notificationRepository().getNotificationById(notificationIdOf(entry));
  if (!notification) return;

  const userId = String(notification.user_id ?? notification.userId ?? '');
  const user = await getUserById(userId);
  if (!user?.email) return; // nothing to send to — not a delivery failure worth retrying

  await sendNotificationEmail(
    user.email,
    String(notification.title ?? ''),
    String(notification.body ?? ''),
    notification.deep_link ?? notification.deepLink ?? null
  );
};
