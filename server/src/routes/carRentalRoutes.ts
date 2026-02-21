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

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
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
  const {
    tripId,
    status: incomingStatus,
    pickupLocation,
    pickupDate,
    dropoffLocation,
    dropoffDate,
    reference,
    vendor,
    prepaid,
    cost,
    model,
    notes,
    paidBy,
    travelerIds,
  } = req.body ?? {};

  const status = normalizeItineraryStatus(incomingStatus);
  const relaxed = shouldRelaxRequiredFields(status);
  if (!tripId || (!relaxed && !String(pickupLocation ?? '').trim() && !String(vendor ?? '').trim() && !String(model ?? '').trim())) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const membership = await ensureUserInTrip(String(tripId), userId);
  if (!membership) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }

  const rental = await insertCarRental({
    userId,
    tripId: String(tripId),
    status,
    pickupLocation: String(pickupLocation ?? '').trim(),
    pickupDate: String(pickupDate ?? '').trim(),
    dropoffLocation: String(dropoffLocation ?? '').trim(),
    dropoffDate: String(dropoffDate ?? '').trim(),
    reference: String(reference ?? '').trim(),
    vendor: String(vendor ?? '').trim(),
    prepaid: String(prepaid ?? '').trim(),
    cost: Number(cost) || 0,
    model: String(model ?? '').trim(),
    notes: String(notes ?? '').trim(),
    paidBy: Array.isArray(paidBy) ? paidBy.map((id: any) => String(id)).filter(Boolean) : [],
    travelerIds: Array.isArray(travelerIds)
      ? travelerIds.map((id: any) => String(id)).filter(Boolean)
      : Array.isArray(paidBy)
        ? paidBy.map((id: any) => String(id)).filter(Boolean)
        : [],
  } as any);

  await upsertExpenseForSource({
    userId,
    tripId: String(tripId),
    groupId: membership.groupId,
    expenseDate: String(pickupDate ?? '').trim() || new Date().toISOString().slice(0, 10),
    category: 'Car Rentals',
    amount: Number(cost) || 0,
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
  const updates = req.body ?? {};
  const updated = await updateCarRental(req.params.id, userId, {
    status: typeof updates.status === 'undefined' ? undefined : normalizeItineraryStatus(updates.status),
    pickupLocation: typeof updates.pickupLocation === 'undefined' ? undefined : String(updates.pickupLocation),
    pickupDate: typeof updates.pickupDate === 'undefined' ? undefined : String(updates.pickupDate),
    dropoffLocation: typeof updates.dropoffLocation === 'undefined' ? undefined : String(updates.dropoffLocation),
    dropoffDate: typeof updates.dropoffDate === 'undefined' ? undefined : String(updates.dropoffDate),
    reference: typeof updates.reference === 'undefined' ? undefined : String(updates.reference),
    vendor: typeof updates.vendor === 'undefined' ? undefined : String(updates.vendor),
    prepaid: typeof updates.prepaid === 'undefined' ? undefined : String(updates.prepaid),
    cost: typeof updates.cost === 'undefined' ? undefined : Number(updates.cost) || 0,
    model: typeof updates.model === 'undefined' ? undefined : String(updates.model),
    notes: typeof updates.notes === 'undefined' ? undefined : String(updates.notes),
    paidBy: Array.isArray(updates.paidBy) ? updates.paidBy.map((id: any) => String(id)).filter(Boolean) : undefined,
    travelerIds: Array.isArray(updates.travelerIds)
      ? updates.travelerIds.map((id: any) => String(id)).filter(Boolean)
      : undefined,
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
  await deleteCarRental(req.params.id, userId);
  await deleteExpenseForSource('car_rental', req.params.id, userId);
  res.status(204).send();
});

router.post('/:id/vote', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const valueRaw = Number(req.body?.value);
  const value = valueRaw === 1 ? 1 : valueRaw === -1 ? -1 : null;
  if (value == null) {
    res.status(400).json({ error: 'value must be 1 or -1' });
    return;
  }

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

  await castItemVote(userId, tripId, 'car_rental', req.params.id, value);
  const summary = await getItemVoteSummaries(userId, tripId, 'car_rental', [req.params.id]);
  res.json({
    itemId: req.params.id,
    netVotes: summary[req.params.id]?.netVotes ?? 0,
    userVote: summary[req.params.id]?.userVote ?? value,
  });
});

export default router;
