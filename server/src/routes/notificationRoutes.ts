import { Router } from 'express';
import { authenticate } from '../auth';
import { notificationRepository } from '../services/notificationRepository';
import { isFeatureEnabled } from '../services/entitlementService';
import { encryptPushToken, hashPushToken } from '../utils/pushTokenCrypto';

const router = Router();
router.use(authenticate);

const userIdOf = (req: any): string => String(req.user?.userId ?? '');

// architecture §9.1 — fail-closed (entitlementService.ts's FAIL_CLOSED_FLAGS): the in-app inbox
// itself, not just delivery, is gated so the whole surface can be switched off cleanly.
router.use(async (req, res, next) => {
  if (!(await isFeatureEnabled('notifications_in_app'))) {
    res.status(404).json({ error: 'Notifications are not enabled' });
    return;
  }
  next();
});

router.get('/', async (req, res) => {
  const options = {
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    unreadOnly: req.query.unreadOnly === 'true',
  };
  const notifications = await notificationRepository().listNotifications(userIdOf(req), options);
  const unreadCount = await notificationRepository().getUnreadCount(userIdOf(req));
  res.json({ notifications, unreadCount });
});

router.post('/read', async (req, res) => {
  const ids = req.body.all === true ? 'all' : Array.isArray(req.body.ids) ? req.body.ids : [];
  await notificationRepository().markAsRead(userIdOf(req), ids);
  res.status(204).end();
});

router.get('/devices', async (req, res) => {
  const devices = await notificationRepository().listDevices(userIdOf(req));
  res.json({ devices });
});

router.post('/devices', async (req, res) => {
  // The client sends the raw Expo push token over HTTPS — the server encrypts it here (never the
  // client; see pushTokenCrypto.ts) before it's persisted. pushTokenHash is derived server-side
  // too, not trusted from the request, since it's the UNIQUE(user_id, push_token_hash) upsert key.
  const { platform, pushToken, deviceLabel } = req.body;
  if (!platform || typeof pushToken !== 'string' || !pushToken.trim()) {
    res.status(400).json({ error: 'Missing required device fields' });
    return;
  }
  if (!['ios', 'android', 'web'].includes(platform)) {
    res.status(400).json({ error: 'Unsupported platform' });
    return;
  }
  const trimmedToken = pushToken.trim();
  await notificationRepository().upsertDevice(userIdOf(req), {
    platform,
    pushTokenCiphertext: encryptPushToken(trimmedToken),
    pushTokenHash: hashPushToken(trimmedToken),
    deviceLabel,
  });
  res.status(204).end();
});

router.delete('/devices/:id', async (req, res) => {
  await notificationRepository().deleteDevice(userIdOf(req), req.params.id);
  res.status(204).end();
});

router.patch('/preferences', async (req, res) => {
  const { preferences } = req.body;
  if (!Array.isArray(preferences)) {
    res.status(400).json({ error: 'preferences must be an array' });
    return;
  }
  await notificationRepository().updatePreferences(userIdOf(req), preferences);
  res.status(204).end();
});

export default router;
