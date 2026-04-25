import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  castItemVote,
  deleteCarRental,
  deleteExpenseForSource,
  ensureUserInTrip,
  getCarRentalById,
  getItemVoteSummaries,
  insertCarRental,
  listCarRentals,
  updateCarRental,
  upsertExpenseForSource,
} from '../db';
import { normalizeItineraryStatus, shouldRelaxRequiredFields } from '../utils/itineraryStatus';
import { applyVoteSummary } from '../services/itemVoteService';
import { assertCanUseFeature } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { TokenPayload } from '../auth';
import { readDto } from '../utils/dtoParse';
import { createCarRentalDto, updateCarRentalDto, voteOrRatingDto } from './carRentalDtos';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const tripId = req.query.tripId as string | undefined;
  try {
    await assertCanUseFeature(userId, 'car_rentals', role);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  const rentals = await listCarRentals(userId, tripId);
  if (tripId) {
    const withVotes = await applyVoteSummary(userId, tripId, 'car_rental', rentals as any[]);
    res.json(withVotes);
    return;
  }
  const grouped = new Map<string, any[]>();
  (rentals as any[]).forEach((rental) => {
    const tId = String((rental as any).tripId ?? (rental as any).trip_id ?? '');
    if (!tId) return;
    const bucket = grouped.get(tId) ?? [];
    bucket.push(rental);
    grouped.set(tId, bucket);
  });
  const merged: any[] = [];
  for (const [tId, items] of grouped.entries()) {
    const withVotes = await applyVoteSummary(userId, tId, 'car_rental', items);
    merged.push(...withVotes);
  }
  res.json(merged.length ? merged : rentals);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const dto = readDto(createCarRentalDto, req.body, res);
  if (!dto) return;

  const status = normalizeItineraryStatus(dto.status);
  const relaxed = shouldRelaxRequiredFields(status);
  try {
    await assertCanUseFeature(userId, 'car_rentals', role);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  if (!relaxed && !dto.pickupLocation && !dto.vendor && !dto.model) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const membership = await ensureUserInTrip(dto.tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }

  // Preserve legacy fallback: when caller omits travelerIds, inherit paidBy.
  const travelerIds = dto.travelerIds.length ? dto.travelerIds : dto.paidBy;

  const rental = await insertCarRental({
    userId,
    tripId: dto.tripId,
    status,
    pickupLocation: dto.pickupLocation,
    pickupDate: dto.pickupDate,
    dropoffLocation: dto.dropoffLocation,
    dropoffDate: dto.dropoffDate,
    reference: dto.reference,
    vendor: dto.vendor,
    prepaid: dto.prepaid,
    cost: dto.cost,
    model: dto.model,
    notes: dto.notes,
    paidBy: dto.paidBy,
    travelerIds,
  } as any);

  await upsertExpenseForSource({
    userId,
    tripId: dto.tripId,
    groupId: membership.groupId,
    expenseDate: dto.pickupDate || new Date().toISOString().slice(0, 10),
    category: 'Car Rentals',
    amount: dto.cost,
    currency: undefined,
    payerIds: Array.isArray((rental as any).paidBy) ? (rental as any).paidBy : [],
    forIds: Array.isArray((rental as any).travelerIds) ? (rental as any).travelerIds : [],
    sourceType: 'car_rental',
    sourceId: rental.id,
  });

  res.status(201).json(rental);
});

router.patch('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  try {
    await assertCanUseFeature(userId, 'car_rentals', role);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  const dto = readDto(updateCarRentalDto, req.body ?? {}, res);
  if (!dto) return;

  const coerceStringArray = (arr: Array<string | number> | null | undefined): string[] | undefined =>
    Array.isArray(arr) ? arr.map((id) => String(id).trim()).filter(Boolean) : undefined;

  const updated = await updateCarRental(req.params.id, userId, {
    status: dto.status == null ? undefined : normalizeItineraryStatus(String(dto.status)),
    pickupLocation: dto.pickupLocation == null ? undefined : String(dto.pickupLocation),
    pickupDate: dto.pickupDate == null ? undefined : String(dto.pickupDate),
    dropoffLocation: dto.dropoffLocation == null ? undefined : String(dto.dropoffLocation),
    dropoffDate: dto.dropoffDate == null ? undefined : String(dto.dropoffDate),
    reference: dto.reference == null ? undefined : String(dto.reference),
    vendor: dto.vendor == null ? undefined : String(dto.vendor),
    prepaid: dto.prepaid == null ? undefined : String(dto.prepaid),
    cost: dto.cost == null ? undefined : Number(dto.cost) || 0,
    model: dto.model == null ? undefined : String(dto.model),
    notes: dto.notes == null ? undefined : String(dto.notes),
    paidBy: coerceStringArray(dto.paidBy ?? undefined),
    travelerIds: coerceStringArray(dto.travelerIds ?? undefined),
  } as any);

  if (!updated) {
    res.status(404).json({ error: 'Car rental not found' });
    return;
  }

  const tripId = String((updated as any).tripId ?? '');
  const membership = tripId ? await ensureUserInTrip(tripId, userId) : null;
  if (membership) {
    await upsertExpenseForSource({
      userId,
      tripId,
      groupId: membership.groupId,
      expenseDate: String((updated as any).pickupDate ?? '').trim() || new Date().toISOString().slice(0, 10),
      category: 'Car Rentals',
      amount: Number((updated as any).cost) || 0,
      currency: undefined,
      payerIds: Array.isArray((updated as any).paidBy) ? (updated as any).paidBy : [],
      forIds: Array.isArray((updated as any).travelerIds) ? (updated as any).travelerIds : [],
      sourceType: 'car_rental',
      sourceId: updated.id,
    });
  }

  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  try {
    await assertCanUseFeature(userId, 'car_rentals', role);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  await deleteCarRental(req.params.id, userId);
  await deleteExpenseForSource('car_rental', req.params.id, userId);
  res.status(204).send();
});

router.post('/:id/vote', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const dto = readDto(voteOrRatingDto, req.body, res);
  if (!dto) return;
  const value = dto.value;

  const rental = await getCarRentalById(req.params.id);
  if (!rental) {
    res.status(404).json({ error: 'Car rental not found' });
    return;
  }
  const tripId = String((rental as any).tripId ?? (rental as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Car rental has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may vote' });
    return;
  }
  const status = normalizeItineraryStatus((rental as any).status);
  if (status !== 'Proposed') {
    res.status(400).json({ error: 'Voting is only allowed for Proposed items' });
    return;
  }

  await castItemVote(userId, tripId, 'car_rental', req.params.id, value, 'vote');
  const summary = await getItemVoteSummaries(userId, tripId, 'car_rental', [req.params.id], 'vote');
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

  const rental = await getCarRentalById(req.params.id);
  if (!rental) {
    res.status(404).json({ error: 'Car rental not found' });
    return;
  }
  const tripId = String((rental as any).tripId ?? (rental as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Car rental has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may rate' });
    return;
  }
  const status = normalizeItineraryStatus((rental as any).status);
  if (status !== 'Completed') {
    res.status(400).json({ error: 'Rating is only allowed for Completed items' });
    return;
  }

  await castItemVote(userId, tripId, 'car_rental', req.params.id, value, 'rating');
  const summary = await getItemVoteSummaries(userId, tripId, 'car_rental', [req.params.id], 'rating');
  res.json({
    itemId: req.params.id,
    netRating: summary[req.params.id]?.netVotes ?? 0,
    userRating: summary[req.params.id]?.userVote ?? value,
  });
});

export default router;
