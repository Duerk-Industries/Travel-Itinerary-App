import { quietUntil } from './notificationTiming';
import { putNotificationWork } from './notificationWorkRepository';
import { createHash, randomUUID } from 'crypto';
import { notificationRepository } from './notificationRepository';
import { logError, logInfo } from '../logger';
import { getApiCacheSetting } from '../config/apiLimits';
import { isFeatureEnabled } from './entitlementService';
import { getNotificationPreference } from './notificationService';
import { ensureUserCanReadTrip, getUserById } from '../db';
import { sendNotificationEmail } from '../mailer';
import { sendExpoPushNotifications } from '../apis/expoPushApi';
import { decryptPushToken } from '../utils/pushTokenCrypto';
import { getEnvFlag } from '../env';

// Phase 4.5: Notification outbox worker.
// Durable, leased provider delivery (architecture §13.3).

const BATCH_SIZE = 10;
const LEASE_SECONDS = 300;
const TICK_MS = 5000;

export class NotificationDeliveryPaused extends Error {
  constructor(message: string, readonly until?: number) { super(message); }
}

export const drainNotificationOutbox = async (): Promise<void> => {
  const leaseOwner = `outbox-worker-${randomUUID()}`;
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
          await notificationRepository().updateOutboxState(entry.id, 'sent', { leaseOwner });
        } catch (err) {
          if (err instanceof NotificationDeliveryPaused) {
            await notificationRepository().updateOutboxState(entry.id, 'pending', { nextAttemptAt: new Date(err.until ?? Date.now() + 60 * 60_000), leaseOwner, lastErrorCode: 'CHANNEL_PAUSED' });
            continue;
          }
          // entry.attempt_count (Postgres row) vs entry.attemptCount (Firestore doc) — the two
          // repositories don't share a casing convention (see notificationRepository.ts), so this
          // reads whichever one the active provider actually set.
          const attemptCount = Number(entry.attempt_count ?? entry.attemptCount ?? 0) + 1;
          const isDead = attemptCount >= 5;
          const nextAttemptAt = new Date(Date.now() + Math.pow(2, attemptCount) * 1000);
          await notificationRepository().updateOutboxState(entry.id, isDead ? 'dead' : 'pending', {
            leaseOwner, attemptCount,
            nextAttemptAt,
            lastErrorCode: String((err as any)?.message || 'DELIVERY_FAILED').slice(0, 100),
          });
          logError(`[notification-outbox] delivery failed for entry ${entry.id}`, err);
        }
      }

};
export const startNotificationOutboxWorker = () => {
  if (!getEnvFlag('NOTIFICATION_OUTBOX_WORKER_ENABLED', { defaultValue: true })) return;
  setInterval(() => { void drainNotificationOutbox().catch(error => logError('[notification-outbox] worker tick failed', error)); }, TICK_MS);
};

// Both repositories' rows are read defensively below (snake_case Postgres columns vs camelCase
// Firestore fields) for the same reason as the attemptCount read above.
const notificationIdOf = (entry: any): string => String(entry.notification_id ?? entry.notificationId ?? '');

export const deliverPush = async (entry: any) => {
  const notification = await notificationRepository().getNotificationById(notificationIdOf(entry));
  if (!notification) return; // notification since pruned/deleted — nothing left to deliver

  const userId = String(notification.user_id ?? notification.userId ?? '');
  const tripId = notification.trip_id ?? notification.tripId;
  if (tripId && !(await ensureUserCanReadTrip(String(tripId), userId))) return;
  const preference = await getNotificationPreference(userId, notification.category);
  if (!preference.push) return;
  const until = quietUntil(preference.quietTiming);
  if (until) throw new NotificationDeliveryPaused('Quiet hours', until);
  const pushEnabled = await isFeatureEnabled('notifications_push', userId);
  if (!pushEnabled) throw new NotificationDeliveryPaused('Push delivery is paused');
  const devices = pushEnabled ? await notificationRepository().listActivePushDevicesForUser(userId) : [];

  if (!devices.length) {
    // Independently consented email already has its own atomic outbox row.
    // Sending it here as well would duplicate email on no-device retries.
    throw new NotificationDeliveryPaused('No consenting mobile device');
  }

  const messages = devices.map((d) => ({
    to: decryptPushToken(String(d.push_token_ciphertext ?? d.pushTokenCiphertext ?? '')),
    sound: 'default' as const,
    title: 'Travel update',
    body: 'Open WanderBunnies to view this update.',
    data: { notificationId: notification.id },
  }));

  const { tickets } = await sendExpoPushNotifications({ caller: 'NOTIFICATION_PUSH', messages });

  await Promise.all(devices.map(async (device, index) => {
    const ticket = tickets[index];
    if (ticket?.status === 'ok') {
      await putNotificationWork({ id: createHash('sha256').update(`receipt:${ticket.id}`).digest('hex'), kind: 'receipt', dueAt: Date.now() + 15 * 60_000,
        data: { ticketId: ticket.id, deviceId: device.id, userId, expiresAt: Date.now() + 24 * 3600_000 } });
      return;
    }
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
  if (tickets.some(ticket => !ticket || (ticket.status === 'error' && ticket.details?.error !== 'DeviceNotRegistered'))) throw new Error('PUSH_RETRY_REQUIRED');
};

export const deliverEmail = async (entry: any) => {
  const notification = await notificationRepository().getNotificationById(notificationIdOf(entry));
  if (!notification) return;

  const userId = String(notification.user_id ?? notification.userId ?? '');
  const tripId = notification.trip_id ?? notification.tripId;
  if (tripId && !(await ensureUserCanReadTrip(String(tripId), userId))) return;
  const preference = await getNotificationPreference(userId, notification.category);
  if (!preference.email) return;
  if (!(await isFeatureEnabled('notifications_email', userId))) throw new NotificationDeliveryPaused('Email delivery is paused');
  const until = quietUntil(preference.quietTiming);
  if (until) throw new NotificationDeliveryPaused('Quiet hours', until);
  const user = await getUserById(userId);
  if (!user?.email) return; // nothing to send to — not a delivery failure worth retrying

  await sendNotificationEmail(
    user.email,
    String(notification.title ?? ''),
    String(notification.body ?? ''),
    notification.deep_link ?? notification.deepLink ?? null
  );
};
