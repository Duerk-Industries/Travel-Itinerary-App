import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { deleteLodging, ensureUserInTrip, insertLodging, listLodgings, updateLodging } from '../db';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  const lodgings = await listLodgings(userId, tripId);
  res.json(lodgings);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { name, checkInDate, checkOutDate, rooms, refundBy, totalCost, costPerNight, address, tripId, paidBy } = req.body;
  if (!name || !checkInDate || !checkOutDate || !tripId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const tripGroup = await ensureUserInTrip(tripId, userId);
  if (!tripGroup) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const lodging = await insertLodging({
    userId,
    tripId,
    name,
    checkInDate,
    checkOutDate,
    rooms: Number(rooms) || 1,
    refundBy: refundBy || null,
    totalCost: Number(totalCost) || 0,
    costPerNight: Number(costPerNight) || 0,
    address,
    paidBy: Array.isArray(paidBy) ? paidBy : [],
  });
  res.status(201).json(lodging);
});

router.put('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { name, checkInDate, checkOutDate, rooms, refundBy, totalCost, costPerNight, address, tripId, paidBy } = req.body;
  const updated = await updateLodging(req.params.id, userId, {
    name,
    checkInDate,
    checkOutDate,
    rooms: rooms ? Number(rooms) : undefined,
    refundBy: typeof refundBy === 'undefined' ? undefined : refundBy || null,
    totalCost: typeof totalCost === 'undefined' ? undefined : Number(totalCost) || 0,
    costPerNight: typeof costPerNight === 'undefined' ? undefined : Number(costPerNight) || 0,
    address,
    paidBy: Array.isArray(paidBy) ? paidBy : undefined,
    tripId,
  });
  if (!updated) {
    res.status(404).json({ error: 'Lodging not found' });
    return;
  }
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  await deleteLodging(req.params.id, userId);
  res.status(204).send();
});

export default router;
