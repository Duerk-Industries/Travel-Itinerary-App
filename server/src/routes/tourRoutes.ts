import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { deleteExpenseForSource, deleteTour, ensureUserInTrip, insertTour, listGroupMembers, listTours, updateTour, upsertExpenseForSource } from '../db';
import { normalizeItineraryStatus, shouldRelaxRequiredFields } from '../utils/itineraryStatus';

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

export default router;
