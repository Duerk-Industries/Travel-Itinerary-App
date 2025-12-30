import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { deleteTour, ensureUserInTrip, insertTour, listTours, updateTour } from '../db';

// Tours API: CRUD for tours scoped to the authenticated user / their group trips.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  const tours = await listTours(userId, tripId);
  res.json(tours);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { tripId, date, name, startLocation, startTime, duration, cost, freeCancelBy, bookedOn, reference, paidBy } = req.body;
  if (!tripId || !date || !name) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const tripGroup = await ensureUserInTrip(tripId, userId);
  if (!tripGroup) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const tour = await insertTour({
    userId,
    tripId,
    date,
    name,
    startLocation: startLocation ?? '',
    startTime: startTime ?? '',
    duration: duration ?? '',
    cost: Number(cost) || 0,
    freeCancelBy: freeCancelBy || null,
    bookedOn: bookedOn ?? '',
    reference: reference ?? '',
    paidBy: Array.isArray(paidBy) ? paidBy : [],
  });
  res.status(201).json(tour);
});

router.put('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const id = req.params.id;
  const { date, name, startLocation, startTime, duration, cost, freeCancelBy, bookedOn, reference, paidBy } = req.body;
  const updated = await updateTour(id, userId, {
    date,
    name,
    startLocation,
    startTime,
    duration,
    cost: typeof cost === 'undefined' ? undefined : Number(cost),
    freeCancelBy,
    bookedOn,
    reference,
    paidBy: Array.isArray(paidBy) ? paidBy : undefined,
  });
  if (!updated) {
    res.status(404).json({ error: 'Tour not found' });
    return;
  }
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  await deleteTour(req.params.id, userId);
  res.status(204).send();
});

export default router;
