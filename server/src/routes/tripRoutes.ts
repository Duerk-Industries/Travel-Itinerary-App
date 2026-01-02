import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { createTrip, deleteTrip, listTrips, updateTripGroup } from '../db';

// Trips API: create/list/delete trips for the authenticated user.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const trips = await listTrips(userId);
  res.json(trips);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { name, groupId } = req.body ?? {};
  if (!name || !groupId) {
    res.status(400).json({ error: 'name and groupId are required' });
    return;
  }
  try {
    const trip = await createTrip(userId, groupId, name.trim());
    res.status(201).json(trip);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteTrip(userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/:id/group', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { groupId } = req.body ?? {};
  if (!groupId) {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  try {
    const updated = await updateTripGroup(userId, req.params.id, groupId);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
