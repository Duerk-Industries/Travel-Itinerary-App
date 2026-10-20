import { createHash } from 'crypto';
import * as db from '../db';
import { isFeatureEnabled } from './entitlementService';
import { digestDueAt } from './notificationTiming';
import { getNotificationPreference, notify } from './notificationService';
import { claimNotificationWork, completedPlanningSourcePage, finishNotificationWork, planningTripScanPage, prunePlanningWork, putNotificationWork, type NotificationWork } from './notificationWorkRepository';
import { notificationRepository } from './notificationRepository';
import { getExpoPushReceipts } from '../apis/expoPushApi';
import { logError } from '../logger';

const DAY = 86400_000;
const key = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
// Date-only cancellation fields are interpreted conservatively as 00:00 UTC.
// No locale parsing, assumed hotel timezone or DST shift is introduced.
export const cancellationInstant = (value: unknown): number | null => {
  if (value instanceof Date) value = value.toISOString().slice(0, 10);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const date = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(date) ? date : null;
};

const scan = async (job: NotificationWork, now: number) => {
  if (job.data.source === 'imports' || job.data.source === 'generation') {
    const source = job.data.source;
    const page = await completedPlanningSourcePage(source, String(job.data.cursor || ''));
    for (const record of page) {
      if (record.dryRun || Date.parse(record.createdAt) < now - 7 * DAY) continue;
      if (!(await db.getUserById(record.userId))) continue;
      let response = record.response;
      if (typeof response === 'string') { try { response = JSON.parse(response); } catch { continue; } }
      if (source === 'generation' && (!(response && typeof response === 'object' && 'itineraryId' in response) || !record.tripId || !(await db.ensureUserCanReadTrip(record.tripId, record.userId)))) continue;
      await notify({ userIds: [record.userId], category: source === 'imports' ? 'import_result' : 'ai_finished', tripId: record.tripId ?? null,
        title: source === 'imports' ? 'Your booking preview is ready' : 'Your itinerary is ready',
        body: source === 'imports' ? 'Open Imports to check the details and choose a trip.' : 'Open your trip to review the new plan.',
        dedupeKey: `${source}:${record.id}`, requireDurable: true });
    }
    await finishNotificationWork(job, { dueAt: now + (page.length === 25 ? 1000 : 60_000), data: { source, cursor: page.length === 25 ? page[page.length - 1].id : '' } });
    return;
  }
  const page = await planningTripScanPage(String(job.data.cursor || ''));
  for (const trip of page) {
    if (!trip.ownerId || !(await db.ensureUserInTrip(trip.id, trip.ownerId))) continue;
    const [activities, lodgings] = await Promise.all([db.listActivities(trip.ownerId, trip.id), db.listLodgings(trip.ownerId, trip.id)]);
    for (const item of [...activities.map(item => ({ id: item.id, kind: 'activity', status: item.status, deadline: item.freeCancelBy })),
      ...lodgings.map(item => ({ id: item.id, kind: 'lodging', status: item.status, deadline: item.refund_by ?? (item as any).refundBy }))]) {
      const deadline = cancellationInstant(item.deadline);
      if (!deadline || deadline <= now || item.status === 'Cancelled' || deadline > now + 30 * DAY) continue;
      await putNotificationWork({ id: key(['deadline', trip.id, item.kind, item.id, deadline]), kind: 'deadline', dueAt: Math.max(now, deadline - 2 * DAY),
        data: { tripId: trip.id, ownerId: trip.ownerId, itemId: item.id, itemKind: item.kind, deadline, timezone: 'UTC', dstPolicy: 'fixed-instant' } });
    }
    const day = new Date(now).toISOString().slice(0, 10);
    await putNotificationWork({ id: key(['digest', trip.id, day]), kind: 'digest', dueAt: Date.parse(`${day}T00:00:00Z`) + DAY,
      data: { tripId: trip.id, ownerId: trip.ownerId, day, timezone: 'UTC', dstPolicy: 'fixed-UTC-day' } });
  }
  await finishNotificationWork(job, { dueAt: now + (page.length === 25 ? 1000 : 60_000), data: { cursor: page.length === 25 ? page[page.length - 1].id : '' } });
};

const deliver = async (job: NotificationWork, now: number) => {
  if (job.kind === 'receipt') {
    if (!(await isFeatureEnabled('notifications_push', String(job.data.userId)))) { await finishNotificationWork(job, { dueAt: now + 3600_000 }); return; }
    const receipt = (await getExpoPushReceipts([String(job.data.ticketId)]))[String(job.data.ticketId)];
    if (!receipt) {
      if (now < Number(job.data.expiresAt)) { await finishNotificationWork(job, { dueAt: now + 15 * 60_000 }); return; }
    } else if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
      await notificationRepository().deleteDevice(String(job.data.userId), String(job.data.deviceId));
    }
    await finishNotificationWork(job); return;
  }
  const tripId = String(job.data.tripId); const ownerId = String(job.data.ownerId);
  if (!(await db.ensureUserInTrip(tripId, ownerId))) { await finishNotificationWork(job); return; }
  const trip = await db.getTripById(tripId);
  if (!trip) { await finishNotificationWork(job); return; }
  const members = await db.listGroupMembers(trip.groupId, ownerId);
  const userIds = [...new Set(members.filter(member => member.status === 'active').map(member => member.userId).filter((id): id is string => Boolean(id)))];
  if (job.kind === 'deadline') {
    const item = job.data.itemKind === 'activity' ? await db.getActivityById(String(job.data.itemId)) : await db.getLodgingById(String(job.data.itemId));
    const deadline = item ? cancellationInstant((item as any).freeCancelBy ?? (item as any).refund_by ?? (item as any).refundBy) : null;
    // Editing/cancelling/deleting a booking invalidates the old work. A later
    // bounded reconciliation creates the replacement with its new identity.
    if (!item || (item.tripId ?? (item as any).trip_id) !== tripId || item.status === 'Cancelled' || deadline !== job.data.deadline || deadline! <= now) { await finishNotificationWork(job); return; }
    await notify({ userIds, tripId, category: 'cancellation_deadline', title: 'Check a cancellation deadline',
      body: 'A saved booking’s free cancellation window ends soon. Check the booking terms before making changes.',
      dedupeKey: job.id, requireDurable: true });
  } else {
    const start = Date.parse(`${job.data.day}T00:00:00Z`);
    // A local next-day delivery can be over 24 hours after window close on
    // fall-back days. Keep a bounded 48-hour delivery/recovery horizon.
    if (now > start + 3 * DAY) { await finishNotificationWork(job); return; }
    const events = (await db.listTripActivity(tripId, { limit: 100 })).events.filter(event => {
      const time = Date.parse(event.createdAt); return time >= start && time < start + DAY;
    });
    for (const userId of userIds) {
      if (job.data.targetUserId && job.data.targetUserId !== userId) continue;
      if (!events.some(event => event.actorUserId !== userId)) continue;
      const preference = await getNotificationPreference(userId, 'trip_digest');
      if (!preference.inApp && !preference.push && !preference.email) continue;
      const digestDedupe = String(job.data.digestDedupe ?? key(['digest-user', job.id, userId]));
      const dueAt = preference.digestTiming ? digestDueAt(preference.digestTiming, start + DAY) : start + DAY;
      if (dueAt > now) {
        if (job.data.targetUserId) await finishNotificationWork(job, { dueAt });
        else await putNotificationWork({ id: digestDedupe, kind: 'digest', dueAt,
          data: { ...job.data, targetUserId: userId, digestDedupe, timezone: preference.digestTiming?.timezone ?? 'UTC', dstPolicy: 'first-real-minute' } });
        if (job.data.targetUserId) return;
        continue;
      }
      await notify({ userIds: [userId], tripId, category: 'trip_digest', title: 'Your trip’s daily summary',
        body: 'Tripmates updated your trip. Open it to see their latest changes.', dedupeKey: digestDedupe, requireDurable: true });
    }
  }
  await finishNotificationWork(job);
};

/** Called synchronously by a protected scheduled HTTP request on Cloud Run.
 * No detached ACK or reliance on a resident process. Leases expire after a
 * crash; durable notification+outbox dedupe makes crash-after-create replay safe. */
export const runPlanningNotifications = async (): Promise<{ processed: number; failed: number }> => {
  if (!(await isFeatureEnabled('planning_notifications'))) return { processed: 0, failed: 0 };
  const now = Date.now();
  await prunePlanningWork();
  await putNotificationWork({ id: 'planning-scan-v1', kind: 'scan', dueAt: now, data: { cursor: '' } });
  for (const source of ['imports', 'generation']) await putNotificationWork({ id: `planning-${source}-scan-v1`, kind: 'scan', dueAt: now, data: { source, cursor: '' } });
  const jobs = await claimNotificationWork(now); let failed = 0;
  for (const job of jobs) {
    try { if (job.kind === 'scan') await scan(job, now); else await deliver(job, now); }
    catch { failed += 1; logError('[notifications] scheduled work failed'); await finishNotificationWork(job, { dueAt: now + 5 * 60_000 }); }
  }
  return { processed: jobs.length - failed, failed };
};
