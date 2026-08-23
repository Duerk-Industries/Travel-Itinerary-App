import { Router } from 'express';
import { authenticate } from '../auth';
import { notificationRepository } from '../services/notificationRepository';

const router = Router();
router.use(authenticate);

const userIdOf = (req: any): string => String(req.user?.userId ?? '');

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
  const { platform, pushTokenCiphertext, pushTokenHash, deviceLabel } = req.body;
  if (!platform || !pushTokenCiphertext || !pushTokenHash) {
    res.status(400).json({ error: 'Missing required device fields' });
    return;
  }
  await notificationRepository().upsertDevice(userIdOf(req), { platform, pushTokenCiphertext, pushTokenHash, deviceLabel });
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
