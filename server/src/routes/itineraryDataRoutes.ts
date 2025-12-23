import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  addItineraryDetail,
  createItineraryRecord,
  deleteItineraryDetail,
  deleteItineraryRecord,
  listItineraries,
  listItineraryDetails,
} from '../db';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const items = await listItineraries(userId);
  res.json(items);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { tripId, destination, days, budget } = req.body ?? {};
  if (!tripId || !destination || !days) {
    res.status(400).json({ error: 'tripId, destination, and days are required' });
    return;
  }
  try {
    const created = await createItineraryRecord(userId, tripId, destination, Number(days), budget != null ? Number(budget) : null);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteItineraryRecord(userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/:id/details', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    const details = await listItineraryDetails(userId, req.params.id);
    res.json(details);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/details', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { day, time, activity, cost } = req.body ?? {};
  if (!day || !activity) {
    res.status(400).json({ error: 'day and activity are required' });
    return;
  }
  try {
    const created = await addItineraryDetail(userId, req.params.id, {
      day: Number(day),
      time: time ?? null,
      activity,
      cost: cost != null ? Number(cost) : null,
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/details/:detailId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteItineraryDetail(userId, req.params.detailId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
