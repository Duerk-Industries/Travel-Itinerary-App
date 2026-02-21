import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  castItemVote,
  deleteExpenseForSource,
  deleteLodging,
  ensureUserInTrip,
  getItemVoteSummaries,
  getLodgingById,
  insertLodging,
  listLodgings,
  updateLodging,
  upsertExpenseForSource,
} from '../db';
import { getGooglePlaceImage } from '../image-service';
import { normalizeItineraryStatus, shouldRelaxRequiredFields } from '../utils/itineraryStatus';
import { applyVoteSummary } from '../services/itemVoteService';

// Lodgings API: CRUD for lodgings scoped to the authenticated user / their group trips.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  const lodgings = await listLodgings(userId, tripId);
  if (tripId) {
    const withVotes = await applyVoteSummary(userId, tripId, 'lodging', lodgings as any[]);
    res.json(withVotes);
    return;
  }
  const grouped = new Map<string, any[]>();
  (lodgings as any[]).forEach((lodging) => {
    const tId = String((lodging as any).tripId ?? (lodging as any).trip_id ?? '');
    if (!tId) return;
    const bucket = grouped.get(tId) ?? [];
    bucket.push(lodging);
    grouped.set(tId, bucket);
  });
  const merged: any[] = [];
  for (const [tId, items] of grouped.entries()) {
    const withVotes = await applyVoteSummary(userId, tId, 'lodging', items);
    merged.push(...withVotes);
  }
  res.json(merged.length ? merged : lodgings);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const {
    name,
    checkInDate,
    checkOutDate,
    rooms,
    refundBy,
    totalCost,
    costPerNight,
    address,
    placeId,
    tripId,
    paidBy,
    travelerIds,
    status: incomingStatus,
  } = req.body;
  const status = normalizeItineraryStatus(incomingStatus);
  const relaxed = shouldRelaxRequiredFields(status);
  if ((!relaxed && (!name || !checkInDate || !checkOutDate)) || !tripId) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const tripGroup = await ensureUserInTrip(tripId, userId);
  if (!tripGroup) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  let imageUrl: string | null = null;
  try {
    imageUrl = await getGooglePlaceImage(address ? `${name}, ${address}` : name);
  } catch (error) {
    console.error('Failed to fetch image for lodging:', error);
  }
  const lodging = await insertLodging({
    userId,
    tripId,
    status,
    name,
    checkInDate: checkInDate || new Date().toISOString().slice(0, 10),
    checkOutDate: checkOutDate || checkInDate || new Date().toISOString().slice(0, 10),
    rooms: Number(rooms) || 1,
    refundBy: refundBy || null,
    totalCost: Number(totalCost) || 0,
    costPerNight: Number(costPerNight) || 0,
    address,
    place_id: placeId || null,
    paid_by: Array.isArray(paidBy) ? paidBy : [],
    traveler_ids: Array.isArray(travelerIds) ? travelerIds : Array.isArray(paidBy) ? paidBy : [],
    imageUrl,
  });
  await upsertExpenseForSource({
    userId,
    tripId,
    groupId: tripGroup.groupId,
      expenseDate: checkInDate || new Date().toISOString().slice(0, 10),
    category: 'Lodging',
    amount: Number(totalCost) || 0,
    currency: undefined,
    payerIds: Array.isArray(paidBy) ? paidBy : [],
    forIds: Array.isArray(travelerIds) ? travelerIds : Array.isArray(paidBy) ? paidBy : [],
    sourceType: 'lodging',
    sourceId: lodging.id,
  });
  res.status(201).json(lodging);
});

router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId as string;
    const {
      name,
      checkInDate,
      checkOutDate,
      rooms,
      refundBy,
      totalCost,
      costPerNight,
      address,
      placeId,
      tripId,
      paidBy,
      travelerIds,
      status: incomingStatus,
    } = req.body;
    const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
    const normalizedTravelerIds = Array.isArray(travelerIds) ? (travelerIds.length ? travelerIds : []) : undefined;
    
    let imageUrl: string | null = null;
    if (name || address) {
      const currentLodging = (await listLodgings(userId, tripId)).find((l) => l.id === req.params.id);
      if (currentLodging) {
        const nextName = name ?? currentLodging.name;
        const nextAddress = address ?? currentLodging.address;
        const nameChanged = typeof name === 'string' && name.trim() && name !== currentLodging.name;
        const addressChanged = typeof address === 'string' && address.trim() && address !== currentLodging.address;
        if ((nameChanged || addressChanged) || !currentLodging.imageUrl) {
          try {
            imageUrl = await getGooglePlaceImage(nextAddress ? `${nextName}, ${nextAddress}` : nextName);
          } catch (error) {
            console.error('Failed to fetch image for lodging:', error);
          }
        }
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
      place_id: typeof placeId === 'undefined' ? undefined : placeId || null,
      paid_by: normalizedPaidBy,
      traveler_ids: typeof normalizedTravelerIds === 'undefined' ? undefined : normalizedTravelerIds,
      trip_id: tripId,
      status: typeof incomingStatus === 'undefined' ? undefined : normalizeItineraryStatus(incomingStatus),
      imageUrl: imageUrl ?? undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Lodging not found' });
      return;
    }
    const updatedTripId = (updated as any)?.tripId ?? (updated as any)?.trip_id;
    const updatedCheckIn = (updated as any)?.checkInDate ?? (updated as any)?.check_in_date;
    const updatedTotal = (updated as any)?.totalCost ?? (updated as any)?.total_cost;
    const membership = updatedTripId ? await ensureUserInTrip(updatedTripId as string, userId) : null;
    if (updated && membership) {
      await upsertExpenseForSource({
        userId,
        tripId: updatedTripId as string,
        groupId: membership.groupId,
        expenseDate: updatedCheckIn as string,
        category: 'Lodging',
        amount: Number(updatedTotal) || 0,
        currency: undefined,
        payerIds: Array.isArray((updated as any).paidBy) ? (updated as any).paidBy : [],
        forIds: Array.isArray((updated as any).travelerIds) ? (updated as any).travelerIds : [],
        sourceType: 'lodging',
        sourceId: updated.id,
      });
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
    const {
      name,
      checkInDate,
      checkOutDate,
      rooms,
      refundBy,
      totalCost,
      costPerNight,
      address,
      placeId,
      tripId,
      paidBy,
      travelerIds,
      status: incomingStatus,
    } = req.body;
    const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
    const normalizedTravelerIds = Array.isArray(travelerIds) ? (travelerIds.length ? travelerIds : []) : undefined;

    let imageUrl: string | null = null;
    if (name || address) {
      const currentLodging = (await listLodgings(userId, tripId)).find((l) => l.id === req.params.id);
      if (currentLodging) {
        const nextName = name ?? currentLodging.name;
        const nextAddress = address ?? currentLodging.address;
        const nameChanged = typeof name === 'string' && name.trim() && name !== currentLodging.name;
        const addressChanged = typeof address === 'string' && address.trim() && address !== currentLodging.address;
        if ((nameChanged || addressChanged) || !currentLodging.imageUrl) {
          try {
            imageUrl = await getGooglePlaceImage(nextAddress ? `${nextName}, ${nextAddress}` : nextName);
          } catch (error) {
            console.error('Failed to fetch image for lodging:', error);
          }
        }
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
      place_id: typeof placeId === 'undefined' ? undefined : placeId || null,
      paid_by: normalizedPaidBy,
      traveler_ids: typeof normalizedTravelerIds === 'undefined' ? undefined : normalizedTravelerIds,
      trip_id: tripId,
      status: typeof incomingStatus === 'undefined' ? undefined : normalizeItineraryStatus(incomingStatus),
      imageUrl: imageUrl ?? undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Lodging not found' });
      return;
    }
    const updatedTripId = (updated as any)?.tripId ?? (updated as any)?.trip_id;
    const updatedCheckIn = (updated as any)?.checkInDate ?? (updated as any)?.check_in_date;
    const updatedTotal = (updated as any)?.totalCost ?? (updated as any)?.total_cost;
    const membership = updatedTripId ? await ensureUserInTrip(updatedTripId as string, userId) : null;
    if (updated && membership) {
      await upsertExpenseForSource({
        userId,
        tripId: updatedTripId as string,
        groupId: membership.groupId,
        expenseDate: updatedCheckIn as string,
        category: 'Lodging',
        amount: Number(updatedTotal) || 0,
        currency: undefined,
        payerIds: Array.isArray((updated as any).paidBy) ? (updated as any).paidBy : [],
        forIds: Array.isArray((updated as any).travelerIds) ? (updated as any).travelerIds : [],
        sourceType: 'lodging',
        sourceId: updated.id,
      });
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
    await deleteExpenseForSource('lodging', req.params.id, userId);
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

router.post('/:id/vote', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const valueRaw = Number(req.body?.value);
  const value = valueRaw === 1 ? 1 : valueRaw === -1 ? -1 : null;
  if (value == null) {
    res.status(400).json({ error: 'value must be 1 or -1' });
    return;
  }
  const lodging = await getLodgingById(req.params.id);
  if (!lodging) {
    res.status(404).json({ error: 'Lodging not found' });
    return;
  }
  const tripId = String((lodging as any).tripId ?? (lodging as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Lodging has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may vote' });
    return;
  }
  const status = normalizeItineraryStatus((lodging as any).status);
  if (status !== 'Proposed') {
    res.status(400).json({ error: 'Voting is only allowed for Proposed items' });
    return;
  }
  await castItemVote(userId, tripId, 'lodging', req.params.id, value);
  const summary = await getItemVoteSummaries(userId, tripId, 'lodging', [req.params.id]);
  res.json({
    itemId: req.params.id,
    netVotes: summary[req.params.id]?.netVotes ?? 0,
    userVote: summary[req.params.id]?.userVote ?? value,
  });
});

export default router;
