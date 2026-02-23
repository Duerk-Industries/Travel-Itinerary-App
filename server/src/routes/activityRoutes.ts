import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  castItemVote,
  deleteExpenseForSource,
  deleteActivity,
  ensureUserInTrip,
  getItemVoteSummaries,
  getActivityById,
  insertActivity,
  listGroupMembers,
  listActivities,
  updateActivity,
  upsertExpenseForSource,
} from '../db';
import { normalizeItineraryStatus, shouldRelaxRequiredFields } from '../utils/itineraryStatus';
import { applyVoteSummary } from '../services/itemVoteService';
import type { ActivityType } from '../types';

const ACTIVITY_TYPES: ActivityType[] = [
  'Ticketed Attraction',
  'Reservation',
  'Tour',
  'Open Access',
  'Event',
];
const normalizeActivityType = (value: unknown): ActivityType | null => {
  const str = typeof value === 'string' ? value.trim() : '';
  return (ACTIVITY_TYPES as string[]).includes(str) ? (str as ActivityType) : null;
};

// Activities API: CRUD for activities scoped to the authenticated user / their group trips.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  const activities = await listActivities(userId, tripId);
  if (tripId) {
    const withVotes = await applyVoteSummary(userId, tripId, 'activity', activities as any[]);
    res.json(withVotes);
    return;
  }
  const grouped = new Map<string, any[]>();
  (activities as any[]).forEach((activity) => {
    const tId = String((activity as any).tripId ?? (activity as any).trip_id ?? '');
    if (!tId) return;
    const bucket = grouped.get(tId) ?? [];
    bucket.push(activity);
    grouped.set(tId, bucket);
  });
  const merged: any[] = [];
  for (const [tId, items] of grouped.entries()) {
    const withVotes = await applyVoteSummary(userId, tId, 'activity', items);
    merged.push(...withVotes);
  }
  res.json(merged.length ? merged : activities);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { tripId, date, name, startLocation, startTime, duration, cost, freeCancelBy, bookedOn, reference, paidBy, travelerIds, activityType: incomingActivityType, status: incomingStatus } = req.body;
  const activityType = normalizeActivityType(incomingActivityType) ?? 'Tour';
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
  const activity = await insertActivity({
    userId,
    tripId,
    status,
    activityType,
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
    category: 'Activities',
    amount: Number(cost) || 0,
    currency: undefined,
    payerIds: Array.isArray(paidBy) ? paidBy : [],
    forIds,
    sourceType: 'activity',
    sourceId: activity.id,
  });
  res.status(201).json(activity);
});

router.put('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const id = req.params.id;
  const { date, name, startLocation, startTime, duration, cost, freeCancelBy, bookedOn, reference, paidBy, travelerIds, activityType: incomingActivityType, status: incomingStatus } = req.body;
  const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
  let finalActivityType: ActivityType | undefined;
  if (typeof incomingActivityType !== 'undefined') {
    const normalizedActivityType = normalizeActivityType(incomingActivityType);
    if (!normalizedActivityType) {
      res.status(400).json({ error: 'Invalid activityType' });
      return;
    }
    finalActivityType = normalizedActivityType;
  }
  const finalStatus = typeof incomingStatus === 'undefined' ? undefined : normalizeItineraryStatus(incomingStatus);
  const updated = await updateActivity(id, userId, {
    activityType: finalActivityType,
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
    res.status(404).json({ error: 'Activity not found' });
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
      category: 'Activities',
      amount: Number(updated.cost) || 0,
      currency: undefined,
      payerIds: Array.isArray((updated as any).paidBy) ? (updated as any).paidBy : [],
      forIds,
      sourceType: 'activity',
      sourceId: updated.id,
    });
  }
  res.json(updated);
});

// Allow partial updates via PATCH (used by client/tests for payer updates).
router.patch('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const id = req.params.id;
  const { date, name, startLocation, startTime, duration, cost, freeCancelBy, bookedOn, reference, paidBy, travelerIds, activityType: incomingActivityType, status: incomingStatus } = req.body;
  const normalizedPaidBy = Array.isArray(paidBy) ? (paidBy.length ? paidBy : undefined) : undefined;
  let finalActivityType: ActivityType | undefined;
  if (typeof incomingActivityType !== 'undefined') {
    const normalizedActivityType = normalizeActivityType(incomingActivityType);
    if (!normalizedActivityType) {
      res.status(400).json({ error: 'Invalid activityType' });
      return;
    }
    finalActivityType = normalizedActivityType;
  }
  const finalStatus = typeof incomingStatus === 'undefined' ? undefined : normalizeItineraryStatus(incomingStatus);
  const updated = await updateActivity(id, userId, {
    activityType: finalActivityType,
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
    res.status(404).json({ error: 'Activity not found' });
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
      category: 'Activities',
      amount: Number(updated.cost) || 0,
      currency: undefined,
      payerIds: Array.isArray((updated as any).paidBy) ? (updated as any).paidBy : [],
      forIds,
      sourceType: 'activity',
      sourceId: updated.id,
    });
  }
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  await deleteActivity(req.params.id, userId);
  await deleteExpenseForSource('activity', req.params.id, userId);
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
  const activity = await getActivityById(req.params.id);
  if (!activity) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }
  const tripId = String((activity as any).tripId ?? (activity as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Activity has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may vote' });
    return;
  }
  const status = normalizeItineraryStatus((activity as any).status);
  if (status !== 'Proposed') {
    res.status(400).json({ error: 'Voting is only allowed for Proposed items' });
    return;
  }
  await castItemVote(userId, tripId, 'activity', req.params.id, value, 'vote');
  const summary = await getItemVoteSummaries(userId, tripId, 'activity', [req.params.id], 'vote');
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
  const activity = await getActivityById(req.params.id);
  if (!activity) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }
  const tripId = String((activity as any).tripId ?? (activity as any).trip_id ?? '');
  if (!tripId) {
    res.status(400).json({ error: 'Activity has no trip' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may rate' });
    return;
  }
  const status = normalizeItineraryStatus((activity as any).status);
  if (status !== 'Completed') {
    res.status(400).json({ error: 'Rating is only allowed for Completed items' });
    return;
  }
  await castItemVote(userId, tripId, 'activity', req.params.id, value, 'rating');
  const summary = await getItemVoteSummaries(userId, tripId, 'activity', [req.params.id], 'rating');
  res.json({
    itemId: req.params.id,
    netRating: summary[req.params.id]?.netVotes ?? 0,
    userRating: summary[req.params.id]?.userVote ?? value,
  });
});

export default router;

