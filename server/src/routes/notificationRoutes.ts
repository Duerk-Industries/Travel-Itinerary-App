import { validTimezone } from '../services/notificationTiming';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth';
import { ensureUserCanReadTrip, getActivityById } from '../db';
import { notificationRepository } from '../services/notificationRepository';
import { DEFAULT_PREFERENCES, getNotificationPreference } from '../services/notificationService';
import { notificationCursor, parseNotificationCursor } from '../services/notificationCursor';
import { isFeatureEnabled } from '../services/entitlementService';
import { encryptPushToken, hashPushToken } from '../utils/pushTokenCrypto';
import type { NotificationCategory } from '../types';

const router = Router(); router.use(authenticate);
const owner = (req: Request): string => String((req as Request & { user: { userId: string } }).user.userId);
const safe = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res) => {
  void fn(req, res).catch(() => { if (!res.headersSent) res.status(503).json({ error: 'Notifications are temporarily unavailable.' }); });
};
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Authorization');
  void isFeatureEnabled('notifications_in_app', owner(req)).then(enabled => enabled ? next() : res.status(404).json({ error: 'Notifications are not enabled' })).catch(() => res.status(503).end());
});
const normalize = (row: Record<string, any>) => ({
  id: String(row.id), category: row.category, tripId: row.tripId ?? row.trip_id ?? null,
  title: String(row.title), body: String(row.body), readAt: row.readAt ?? row.read_at ?? null,
  createdAt: new Date(row.createdAt ?? row.created_at).toISOString(),
});
router.get('/', safe(async (req, res) => {
  const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(2048).optional(), unreadOnly: z.enum(['true', 'false']).optional() }).safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: 'Invalid notification page.' }); return; }
  try { parseNotificationCursor(query.data.cursor); } catch { res.status(400).json({ error: 'Invalid notification cursor.' }); return; }
  const repository = notificationRepository();
  const rows = await repository.listNotifications(owner(req), { ...query.data, unreadOnly: query.data.unreadOnly === 'true' });
  const notifications = await Promise.all(rows.map(async row => {
    const notification = normalize(row);
    if (notification.tripId && !(await ensureUserCanReadTrip(notification.tripId, owner(req)))) return { ...notification, title: 'Update unavailable', body: 'You no longer have access to this trip.', tripId: null };
    return notification;
  }));
  res.json({ notifications, unreadCount: await repository.getUnreadCount(owner(req)),
    nextCursor: rows.length === query.data.limit ? notificationCursor(normalize(rows[rows.length - 1])) : null });
}));
router.post('/read', safe(async (req, res) => {
  const parsed = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().min(1).max(512)).max(100) })]).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Choose up to 100 notifications.' }); return; }
  await notificationRepository().markAsRead(owner(req), 'all' in parsed.data ? 'all' : [...new Set(parsed.data.ids)]);
  res.status(204).end();
}));
router.get('/preferences', safe(async (req, res) => {
  const saved = await notificationRepository().getPreferences([owner(req)]);
  const preferences = await Promise.all((Object.keys(DEFAULT_PREFERENCES) as NotificationCategory[]).map(async category => ({ category, ...await getNotificationPreference(owner(req), category, saved) })));
  res.json({ preferences });
}));
router.patch('/preferences', safe(async (req, res) => {
  const schema = z.object({ preferences: z.array(z.object({ category: z.enum(Object.keys(DEFAULT_PREFERENCES) as [string, ...string[]]), inApp: z.boolean(), push: z.boolean(), email: z.boolean(), digestTiming: z.object({ timezone: z.string().max(100).refine(validTimezone), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }).strict().nullable().optional(), quietTiming: z.object({ timezone: z.string().max(100).refine(validTimezone), quietStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), quietEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }).strict().nullable().optional() }).strict()).max(30) }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid notification preferences.' }); return; }
  await notificationRepository().updatePreferences(owner(req), parsed.data.preferences); res.status(204).end();
}));
router.get('/devices', safe(async (req, res) => { res.json({ devices: await notificationRepository().listDevices(owner(req)) }); }));
router.post('/devices', safe(async (req, res) => {
  const parsed = z.object({ platform: z.enum(['ios', 'android', 'web']), pushToken: z.string().trim().min(1).max(1024), deviceLabel: z.string().max(120).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid device registration.' }); return; }
  await notificationRepository().upsertDevice(owner(req), { platform: parsed.data.platform, pushTokenCiphertext: encryptPushToken(parsed.data.pushToken), pushTokenHash: hashPushToken(parsed.data.pushToken), deviceLabel: parsed.data.deviceLabel });
  res.status(204).end();
}));
router.delete('/devices/:id', safe(async (req, res) => { await notificationRepository().deleteDevice(owner(req), String(req.params.id)); res.status(204).end(); }));
router.get('/:id/open', safe(async (req, res) => {
  const row = await notificationRepository().getNotificationById(String(req.params.id));
  if (!row || (row.userId ?? row.user_id) !== owner(req)) { res.status(404).json({ error: 'Update unavailable.' }); return; }
  const tripId = row.tripId ?? row.trip_id;
  if (tripId && !(await ensureUserCanReadTrip(String(tripId), owner(req)))) { res.status(403).json({ error: 'You no longer have access to this trip.' }); return; }
  const activityId = row.payload?.activityId;
  if (activityId) {
    const activity = await getActivityById(String(activityId));
    if (!activity || activity.tripId !== tripId) { res.status(404).json({ error: 'This activity is no longer available.' }); return; }
  }
  // Never return an arbitrary stored URL for the client to follow.
  res.json({ tripId: tripId || null, page: row.category === 'import_result' ? 'ingest' : row.category === 'activity_recap' ? 'blog' : 'overview', activityId: activityId || null });
}));
export default router;
