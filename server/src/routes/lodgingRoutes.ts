import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { deleteLodging, ensureUserInTrip, insertLodging, listLodgings, updateLodging } from '../db';
import { findPlacePhoto } from '../googlePlaces';

// Lodgings API: CRUD for lodgings scoped to the authenticated user / their group trips.
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
  const imageUrl = await findPlacePhoto(address ? `${name}, ${address}` : name);
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
    paid_by: Array.isArray(paidBy) ? paidBy : [],
    imageUrl,
  });
  res.status(201).json(lodging);
});

router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId as string;
    const { name, checkInDate, checkOutDate, rooms, refundBy, totalCost, costPerNight, address, tripId, paidBy } = req.body;
    const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
    
    let imageUrl: string | null = null;
    if (name || address) {
      const currentLodging = (await listLodgings(userId, tripId)).find(l => l.id === req.params.id);
      if (currentLodging) {
        imageUrl = await findPlacePhoto(address ? `${name || currentLodging.name}, ${address}` : name);
      }
    }

    const updated = await updateLodging(req.params.id, userId, {
      name,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      rooms: rooms ? Number(rooms) : undefined,
      refund_by: typeof refundBy === 'undefined' ? undefined : refundBy || null,
      total_cost: typeof totalCost === 'undefined' ? undefined : Number(totalCost) || 0,
      cost_per_night: typeof costPerNight === 'undefined' ? undefined : Number(costPerNight) || 0,
      address,
      paid_by: normalizedPaidBy,
      trip_id: tripId,
      imageUrl: imageUrl ?? undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Lodging not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    const message = (err as Error)?.message ?? 'Unable to update lodging';
    if (message === 'Not authorized') {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

// Support partial updates via PATCH for parity with tests/client expectations.
router.patch('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId as string;
    const { name, checkInDate, checkOutDate, rooms, refundBy, totalCost, costPerNight, address, tripId, paidBy } = req.body;
    const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;

    let imageUrl: string | null = null;
    if (name || address) {
      const currentLodging = (await listLodgings(userId, tripId)).find(l => l.id === req.params.id);
      if (currentLodging) {
        imageUrl = await findPlacePhoto(address ? `${name || currentLodging.name}, ${address}` : name);
      }
    }

    const updated = await updateLodging(req.params.id, userId, {
      name,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      rooms: rooms ? Number(rooms) : undefined,
      refund_by: typeof refundBy === 'undefined' ? undefined : refundBy || null,
      total_cost: typeof totalCost === 'undefined' ? undefined : Number(totalCost) || 0,
      cost_per_night: typeof costPerNight === 'undefined' ? undefined : Number(costPerNight) || 0,
      address,
      paid_by: normalizedPaidBy,
      trip_id: tripId,
      imageUrl: imageUrl ?? undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Lodging not found' });
      return;
    }
    res.json(updated);
  } catch (err) {
    const message = (err as Error)?.message ?? 'Unable to update lodging';
    if (message === 'Not authorized') {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId as string;
    await deleteLodging(req.params.id, userId);
    res.status(204).send();
  } catch (err) {
    const message = (err as Error)?.message ?? 'Unable to delete lodging';
    if (message === 'Not authorized') {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

export default router;
