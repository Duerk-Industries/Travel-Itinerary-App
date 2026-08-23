import { randomUUID } from 'crypto';
import { notificationRepository } from './notificationRepository';
import { logError, logInfo } from '../logger';
import { getApiCacheSetting } from '../config/apiLimits';
import { isFeatureEnabled } from './entitlementService';

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
          const attemptCount = Number(entry.attempt_count) + 1;
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

const deliverPush = async (entry: any) => {
  // Placeholder for real push delivery using expoPushApi.
  logInfo(`[notification-outbox] would deliver push for notification ${entry.notification_id}`);
};

const deliverEmail = async (entry: any) => {
  // Placeholder for real email delivery using smtpCallers.
  logInfo(`[notification-outbox] would deliver email for notification ${entry.notification_id}`);
};
