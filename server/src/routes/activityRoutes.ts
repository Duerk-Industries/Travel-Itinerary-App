import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  castItemVote,
  deleteExpenseForSource,
  deleteTour,
  ensureUserInTrip,
  getItemVoteSummaries,
  getTourById,
  insertTour,
  listGroupMembers,
  listTours,
  updateTour,
  upsertExpenseForSource,
} from '../db';
import { normalizeItineraryStatus, shouldRelaxRequiredFields } from '../utils/itineraryStatus';
import { applyVoteSummary } from '../services/itemVoteService';

// Tours API: CRUD for tours scoped to the authenticated user / their group trips.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  const tours = await listTours(userId, tripId);
  if (tripId) {
    const withVotes = await applyVoteSummary(userId, tripId, 'tour', tours as any[]);
    res.json(withVotes);
    return;
  }
  const grouped = new Map<string, any[]>();
  (tours as any[]).forEach((tour) => {
    const tId = String((tour as any).tripId ?? (tour as any).trip_id ?? '');
    if (!tId) return;
    const bucket = grouped.get(tId) ?? [];
    bucket.push(tour);
    grouped.set(tId, bucket);
  });
  const merged: any[] = [];
  for (const [tId, items] of grouped.entries()) {
    const withVotes = await applyVoteSummary(userId, tId, 'tour', items);
    merged.push(...withVotes);
  }
  res.json(merged.length ? merged : tours);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { tripId, date, name, startLocation, startTime, duration, cost, freeCancelBy, bookedOn, reference, paidBy, travelerIds, status: incomingStatus } = req.body;
  const status = normalizeItineraryStatus(incomingStatus);
  const relaxed = shouldRelaxRequiredFields(status);
  if (!tripId || (!relaxed && (!date || !name))) {
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
    status,
    date: date || new Date().toISOString().slice(0, 10),
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
  const members = await listGroupMembers(tripGroup.groupId, userId).catch(() => []);
  const defaultTravelers = members.map((m) => String((m as any).id));
  const normalizedTravelers = Array.isArray(travelerIds)
    ? travelerIds.map((id: any) => String(id)).filter(Boolean)
    : [];
  const forIds = normalizedTravelers.length ? normalizedTravelers : defaultTravelers;
  await upsertExpenseForSource({
    userId,
    tripId,
    groupId: tripGroup.groupId,
    expenseDate: date || new Date().toISOString().slice(0, 10),
    category: 'Tours',
    amount: Number(cost) || 0,
    currency: undefined,
    payerIds: Array.isArray(paidBy) ? paidBy : [],
    forIds,
    sourceType: 'tour',
    sourceId: tour.id,
  });
  res.status(201).json(tour);
});

router.put('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const id = req.params.id;
  const { date, name, startLocation, startTime, duration, cost, freeCancelBy, bookedOn, reference, paidBy, travelerIds, status: incomingStatus } = req.body;
  const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
  const finalStatus = typeof incomingStatus === 'undefined' ? undefined : normalizeItineraryStatus(incomingStatus);
  const updated = await updateTour(id, userId, {
    status: finalStatus,
    date,
    name,
    startLocation,
    startTime,
    duration,
    cost: typeof cost === 'undefined' ? undefined : Number(cost),
    freeCancelBy,
    bookedOn,
    reference,
    paidBy: normalizedPaidBy,
  });
  if (!updated) {
    res.status(404).json({ error: 'Tour not found' });
    return;
  }
  const membership = await ensureUserInTrip(updated.tripId, userId);
  if (membership) {
    const members = await listGroupMembers(membership.groupId, userId).catch(() => []);
    const defaultTravelers = members.map((m) => String((m as any).id));
    const normalizedTravelers = Array.isArray(travelerIds)
      ? travelerIds.map((id: any) => String(id)).filter(Boolean)
      : [];
    const forIds = normalizedTravelers.length ? normalizedTravelers : defaultTravelers;
    await upsertExpenseForSource({
      userId,
      tripId: updated.tripId,
      groupId: membership.groupId,
      expenseDate: updated.date,
      category: 'Tours',
      amount: Number(updated.cost) || 0,
      currency: undefined,
      payerIds: Array.isArray((updated as any).paidBy) ? (updated as any).paidBy : [],
      forIds,
      sourceType: 'tour',
      sourceId: updated.id,
    });
  }
  res.json(updated);
});

// Allow partial updates via PATCH (used by client/tests for payer updates).
router.patch('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const id = req.params.id;
  const { date, name, startLocation, startTime, duration, cost, freeCancelBy, bookedOn, reference, paidBy, travelerIds, status: incomingStatus } = req.body;
  const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
  const finalStatus = typeof incomingStatus === 'undefined' ? undefined : normalizeItineraryStatus(incomingStatus);
  const updated = await updateTour(id, userId, {
    status: finalStatus,
    date,
    name,
    startLocation,
    startTime,
    duration,
    cost: typeof cost === 'undefined' ? undefined : Number(cost),
    freeCancelBy,
    bookedOn,
    reference,
    paidBy: normalizedPaidBy,
  });
  if (!updated) {
    res.status(404).json({ error: 'Tour not found' });
    return;
  }
  const membership = await ensureUserInTrip(updated.tripId, userId);
  if (membership) {
    const members = await listGroupMembers(membership.groupId, userId).catch(() => []);
    const defaultTravelers = members.map((m) => String((m as any).id));
    const normalizedTravelers = Array.isArray(travelerIds)
      ? travelerIds.map((id: any) => String(id)).filter(Boolean)
      : [];
    const forIds = normalizedTravelers.length ? normalizedTravelers : defaultTravelers;
    await upsertExpenseForSource({
      userId,
      tripId: updated.tripId,
      groupId: membership.groupId,
      expenseDate: updated.date,
      category: 'Tours',
      amount: Number(updated.cost) || 0,
      currency: undefined,
      payerIds: Array.isArray((updated as any).paidBy) ? (updated as any).paidBy : [],
      forIds,
      sourceType: 'tour',
      sourceId: updated.id,
    });
  }
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  await deleteTour(req.params.id, userId);
  await deleteExpenseForSource('tour', req.params.id, userId);
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
  const tour = await getTourById(req.params.id);
  if (!tour) {
    res.status(404).json({ error: 'Tour not found' });
    return;
  }
  const tripId = String((tour as any).tripId ?? (tour as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Tour has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may vote' });
    return;
  }
  const status = normalizeItineraryStatus((tour as any).status);
  if (status !== 'Proposed') {
    res.status(400).json({ error: 'Voting is only allowed for Proposed items' });
    return;
  }
  await castItemVote(userId, tripId, 'tour', req.params.id, value, 'vote');
  const summary = await getItemVoteSummaries(userId, tripId, 'tour', [req.params.id], 'vote');
  res.json({
    itemId: req.params.id,
    netVotes: summary[req.params.id]?.netVotes ?? 0,
    userVote: summary[req.params.id]?.userVote ?? value,
  });
});

router.post('/:id/rating', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const valueRaw = Number(req.body?.value);
  const value = valueRaw === 1 ? 1 : valueRaw === -1 ? -1 : null;
  if (value == null) {
    res.status(400).json({ error: 'value must be 1 or -1' });
    return;
  }
  const tour = await getTourById(req.params.id);
  if (!tour) {
    res.status(404).json({ error: 'Tour not found' });
    return;
  }
  const tripId = String((tour as any).tripId ?? (tour as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Tour has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may rate' });
    return;
  }
  const status = normalizeItineraryStatus((tour as any).status);
  if (status !== 'Completed') {
    res.status(400).json({ error: 'Rating is only allowed for Completed items' });
    return;
  }
  await castItemVote(userId, tripId, 'tour', req.params.id, value, 'rating');
  const summary = await getItemVoteSummaries(userId, tripId, 'tour', [req.params.id], 'rating');
  res.json({
    itemId: req.params.id,
    netRating: summary[req.params.id]?.netVotes ?? 0,
    userRating: summary[req.params.id]?.userVote ?? value,
  });
});

export default router;
