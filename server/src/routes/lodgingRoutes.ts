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
import { readDto } from '../utils/dtoParse';
import { createLodgingDto, updateLodgingDto, voteOrRatingDto } from './lodgingDtos';

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
  const dto = readDto(createLodgingDto, req.body, res);
  if (!dto) return;

  const status = normalizeItineraryStatus(dto.status);
  const relaxed = shouldRelaxRequiredFields(status);
  const nameVal = dto.name ?? '';
  const checkInDate = dto.checkInDate ?? '';
  const checkOutDate = dto.checkOutDate ?? '';
  if (!relaxed && (!nameVal || !checkInDate || !checkOutDate)) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const tripGroup = await ensureUserInTrip(dto.tripId, userId);
  if (!tripGroup) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const addressVal = dto.address ?? '';
  let imageUrl: string | null = null;
  try {
    imageUrl = await getGooglePlaceImage(addressVal ? `${nameVal}, ${addressVal}` : nameVal);
  } catch (error) {
    console.error('Failed to fetch image for lodging:', error);
  }
  // Preserve legacy fallback: when traveler ids are omitted, inherit paidBy.
  const travelerIds = dto.travelerIds.length ? dto.travelerIds : dto.paidBy;
  const lodging = await insertLodging({
    userId,
    tripId: dto.tripId,
    status,
    name: nameVal,
    checkInDate: checkInDate || new Date().toISOString().slice(0, 10),
    checkOutDate: checkOutDate || checkInDate || new Date().toISOString().slice(0, 10),
    rooms: Number(dto.rooms) || 1,
    refundBy: dto.refundBy ?? null,
    totalCost: Number(dto.totalCost) || 0,
    costPerNight: Number(dto.costPerNight) || 0,
    address: addressVal,
    place_id: dto.placeId ?? undefined,
    paid_by: dto.paidBy,
    traveler_ids: travelerIds,
    imageUrl,
  });
  await upsertExpenseForSource({
    userId,
    tripId: dto.tripId,
    groupId: tripGroup.groupId,
    expenseDate: checkInDate || new Date().toISOString().slice(0, 10),
    category: 'Lodging',
    amount: Number(dto.totalCost) || 0,
    currency: undefined,
    payerIds: dto.paidBy,
    forIds: travelerIds,
    sourceType: 'lodging',
    sourceId: lodging.id,
  });
  res.status(201).json(lodging);
});

router.put('/:id', async (req, res) => {
  try {
    const userId = (req as any).user.userId as string;
    const dto = readDto(updateLodgingDto, req.body ?? {}, res);
    if (!dto) return;
    const name = dto.name ?? undefined;
    const checkInDate = dto.checkInDate ?? undefined;
    const checkOutDate = dto.checkOutDate ?? undefined;
    const address = dto.address ?? undefined;
    const tripId = dto.tripId ?? undefined;
    const normalizedPaidBy = Array.isArray(dto.paidBy)
      ? (dto.paidBy.length ? dto.paidBy.map((p) => String(p)) : undefined)
      : undefined;
    const normalizedTravelerIds = Array.isArray(dto.travelerIds)
      ? (dto.travelerIds.length ? dto.travelerIds.map((p) => String(p)) : [])
      : undefined;

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
      rooms: dto.rooms == null ? undefined : Number(dto.rooms),
      refund_by: dto.refundBy == null ? undefined : dto.refundBy || undefined,
      total_cost: dto.totalCost == null ? undefined : Number(dto.totalCost) || 0,
      cost_per_night: dto.costPerNight == null ? undefined : Number(dto.costPerNight) || 0,
      address,
      place_id: dto.placeId == null ? undefined : dto.placeId || undefined,
      paid_by: normalizedPaidBy,
      traveler_ids: normalizedTravelerIds,
      trip_id: tripId,
      status: dto.status == null ? undefined : normalizeItineraryStatus(String(dto.status)),
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
    const dto = readDto(updateLodgingDto, req.body ?? {}, res);
    if (!dto) return;
    const name = dto.name ?? undefined;
    const checkInDate = dto.checkInDate ?? undefined;
    const checkOutDate = dto.checkOutDate ?? undefined;
    const address = dto.address ?? undefined;
    const tripId = dto.tripId ?? undefined;
    const normalizedPaidBy = Array.isArray(dto.paidBy)
      ? (dto.paidBy.length ? dto.paidBy.map((p) => String(p)) : undefined)
      : undefined;
    const normalizedTravelerIds = Array.isArray(dto.travelerIds)
      ? (dto.travelerIds.length ? dto.travelerIds.map((p) => String(p)) : [])
      : undefined;

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
      rooms: dto.rooms == null ? undefined : Number(dto.rooms),
      refund_by: dto.refundBy == null ? undefined : dto.refundBy || undefined,
      total_cost: dto.totalCost == null ? undefined : Number(dto.totalCost) || 0,
      cost_per_night: dto.costPerNight == null ? undefined : Number(dto.costPerNight) || 0,
      address,
      place_id: dto.placeId == null ? undefined : dto.placeId || undefined,
      paid_by: normalizedPaidBy,
      traveler_ids: normalizedTravelerIds,
      trip_id: tripId,
      status: dto.status == null ? undefined : normalizeItineraryStatus(String(dto.status)),
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
  const dto = readDto(voteOrRatingDto, req.body, res);
  if (!dto) return;
  const value = dto.value;
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
  await castItemVote(userId, tripId, 'lodging', req.params.id, value, 'vote');
  const summary = await getItemVoteSummaries(userId, tripId, 'lodging', [req.params.id], 'vote');
  res.json({
    itemId: req.params.id,
    netVotes: summary[req.params.id]?.netVotes ?? 0,
    userVote: summary[req.params.id]?.userVote ?? value,
  });
});

router.post('/:id/rating', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const dto = readDto(voteOrRatingDto, req.body, res);
  if (!dto) return;
  const value = dto.value;
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
    res.status(403).json({ error: 'Only trip members may rate' });
    return;
  }
  const status = normalizeItineraryStatus((lodging as any).status);
  if (status !== 'Completed') {
    res.status(400).json({ error: 'Rating is only allowed for Completed items' });
    return;
  }
  await castItemVote(userId, tripId, 'lodging', req.params.id, value, 'rating');
  const summary = await getItemVoteSummaries(userId, tripId, 'lodging', [req.params.id], 'rating');
  res.json({
    itemId: req.params.id,
    netRating: summary[req.params.id]?.netVotes ?? 0,
    userRating: summary[req.params.id]?.userVote ?? value,
  });
});

export default router;
