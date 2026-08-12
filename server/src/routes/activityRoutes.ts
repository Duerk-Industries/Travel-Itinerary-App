import { Router, type Response } from 'express';
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
import { readDto } from '../utils/dtoParse';
import { createActivityDto, updateActivityDto, voteOrRatingDto, bulkActivitiesDto } from './activityDtos';
import { isFeatureEnabled } from '../services/entitlementService';
import { ApiLimitExceededError, reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { HttpRateLimitExceededError, reserveActivitiesBulkSaveRateLimit } from '../services/httpRateLimitService';

const ACTIVITY_TYPES: ActivityType[] = [
  'Class',
  'Concert/Show',
  'Day Trip',
  'Event',
  'Food & Drink',
  'Fun & Games',
  'Hike',
  'Nightlife',
  'Open Access',
  'Outdoor Activity',
  'Reservation',
  'Shopping',
  'Sights & Landmarks',
  'Spa/Wellness',
  'Ticketed Attraction',
  'Tour',
];
const normalizeActivityType = (value: unknown): ActivityType | null => {
  const str = typeof value === 'string' ? value.trim() : '';
  return (ACTIVITY_TYPES as string[]).includes(str) ? (str as ActivityType) : null;
};

// Activities API: CRUD for activities scoped to the authenticated user / their group trips.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

const reserveActivityUsage = async (caller: string, res: Response): Promise<boolean> => {
  try {
    await reserveApiUsageOrThrow({ provider: 'ACTIVITIES_API', caller });
    return true;
  } catch (err) {
    res.status(err instanceof ApiLimitExceededError ? 429 : 500).json({ error: (err as Error).message });
    return false;
  }
};

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  try {
    await reserveApiUsageOrThrow({ provider: 'ACTIVITIES_API', caller: 'ACTIVITIES_LIST' });
  } catch (err) {
    res.status(err instanceof ApiLimitExceededError ? 429 : 500).json({ error: (err as Error).message });
    return;
  }
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
  if (!(await reserveActivityUsage('ACTIVITIES_ACTIVITY_ROW_WRITE', res))) return;
  const userId = (req as any).user.userId as string;
  const dto = readDto(createActivityDto, req.body, res);
  if (!dto) return;
  const activityType = normalizeActivityType(dto.activityType) ?? 'Tour';
  const status = normalizeItineraryStatus(dto.status);
  const relaxed = shouldRelaxRequiredFields(status);
  const dateVal = dto.date ?? '';
  const nameVal = dto.name ?? '';
  if (!relaxed && (!dateVal || !nameVal)) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const tripGroup = await ensureUserInTrip(dto.tripId, userId);
  if (!tripGroup) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const activity = await insertActivity({
    userId,
    tripId: dto.tripId,
    status,
    activityType,
    date: dateVal || new Date().toISOString().slice(0, 10),
    name: nameVal,
    startLocation: dto.startLocation ?? '',
    startTime: dto.startTime ?? '',
    duration: dto.duration ?? '',
    cost: Number(dto.cost) || 0,
    freeCancelBy: (dto.freeCancelBy ?? null) || null,
    bookedOn: dto.bookedOn ?? '',
    reference: dto.reference ?? '',
    notes: dto.notes ?? '',
    paidBy: dto.paidBy,
    travelerIds: dto.travelerIds,
  });
  const members = await listGroupMembers(tripGroup.groupId, userId).catch(() => []);
  const defaultTravelers = members.map((m) => String((m as any).id));
  const forIds = dto.travelerIds.length ? dto.travelerIds : defaultTravelers;
  await upsertExpenseForSource({
    userId,
    tripId: dto.tripId,
    groupId: tripGroup.groupId,
    expenseDate: dateVal || new Date().toISOString().slice(0, 10),
    category: 'Activities',
    amount: Number(dto.cost) || 0,
    currency: undefined,
    payerIds: dto.paidBy,
    forIds,
    sourceType: 'activity',
    sourceId: activity.id,
  });
  res.status(201).json(activity);
});

router.patch('/bulk', async (req, res) => {
  if (!(await isFeatureEnabled('feature_grid_editing'))) {
    res.status(404).json({ error: 'FEATURE_DISABLED' });
    return;
  }
  const userId = (req as any).user.userId as string;
  const dto = readDto(bulkActivitiesDto, req.body ?? {}, res);
  if (!dto) return;
  try {
    // Per-user/IP burst guard first (cheap, identity-scoped) before touching the
    // shared aggregate budget below.
    await reserveActivitiesBulkSaveRateLimit(userId, req.ip ?? null);
    await reserveApiUsageOrThrow({ provider: 'ACTIVITIES_API', caller: 'ACTIVITIES_BULK_SAVE' });
  } catch (err) {
    if (err instanceof HttpRateLimitExceededError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
      res.status(429).json({ error: err.message });
      return;
    }
    res.status(err instanceof ApiLimitExceededError ? 429 : 500).json({ error: (err as Error).message });
    return;
  }

  const updates: Array<{ id: string; ok: boolean; error?: string; activity?: unknown }> = [];
  const deletes: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const update of dto.updates) {
    try {
      await reserveApiUsageOrThrow({ provider: 'ACTIVITIES_API', caller: 'ACTIVITIES_ACTIVITY_ROW_WRITE' });
      const fields = update.fields;
      const normalizedPaidBy = Array.isArray(fields.paidBy)
        ? (fields.paidBy.length ? fields.paidBy.map((p) => String(p)) : undefined)
        : undefined;
      let finalActivityType: ActivityType | undefined;
      if (fields.activityType != null) {
        const normalizedActivityType = normalizeActivityType(fields.activityType);
        if (!normalizedActivityType) throw new Error('Invalid activityType');
        finalActivityType = normalizedActivityType;
      }
      const normalizedTravelers = Array.isArray(fields.travelerIds)
        ? fields.travelerIds.map((id) => String(id)).filter(Boolean)
        : undefined;
      const updated = await updateActivity(update.id, userId, {
        activityType: finalActivityType,
        status: fields.status == null ? undefined : normalizeItineraryStatus(String(fields.status)),
        date: fields.date ?? undefined,
        name: fields.name ?? undefined,
        startLocation: fields.startLocation ?? undefined,
        startTime: fields.startTime ?? undefined,
        duration: fields.duration ?? undefined,
        cost: fields.cost == null ? undefined : Number(fields.cost),
        freeCancelBy: Object.prototype.hasOwnProperty.call(fields, 'freeCancelBy') ? fields.freeCancelBy : undefined,
        bookedOn: fields.bookedOn ?? undefined,
        reference: fields.reference ?? undefined,
        notes: fields.notes ?? undefined,
        paidBy: normalizedPaidBy,
        travelerIds: normalizedTravelers,
      });
      if (!updated) throw new Error('Activity not found or not authorized');
      const membership = await ensureUserInTrip(updated.tripId, userId);
      if (membership) {
        const members = await listGroupMembers(membership.groupId, userId).catch(() => []);
        const defaultTravelers = members.map((m) => String((m as any).id));
        const forIds = normalizedTravelers && normalizedTravelers.length ? normalizedTravelers : defaultTravelers;
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
      updates.push({ id: update.id, ok: true, activity: updated });
    } catch (err) {
      updates.push({ id: update.id, ok: false, error: (err as Error).message || 'Unable to update activity' });
    }
  }

  for (const id of dto.deletes) {
    try {
      await reserveApiUsageOrThrow({ provider: 'ACTIVITIES_API', caller: 'ACTIVITIES_ACTIVITY_ROW_DELETE' });
      const deleted = await deleteActivity(id, userId);
      if (!deleted) throw new Error('Activity not found or not authorized');
      await deleteExpenseForSource('activity', id, userId);
      deletes.push({ id, ok: true });
    } catch (err) {
      deletes.push({ id, ok: false, error: (err as Error).message || 'Unable to delete activity' });
    }
  }

  res.json({ updates, deletes });
});

router.put('/:id', async (req, res) => {
  if (!(await reserveActivityUsage('ACTIVITIES_ACTIVITY_ROW_WRITE', res))) return;
  const userId = (req as any).user.userId as string;
  const id = req.params.id;
  const dto = readDto(updateActivityDto, req.body ?? {}, res);
  if (!dto) return;

  const normalizedPaidBy = Array.isArray(dto.paidBy)
    ? (dto.paidBy.length ? dto.paidBy.map((p) => String(p)) : undefined)
    : undefined;
  let finalActivityType: ActivityType | undefined;
  if (dto.activityType != null) {
    const normalizedActivityType = normalizeActivityType(dto.activityType);
    if (!normalizedActivityType) {
      res.status(400).json({ error: 'Invalid activityType' });
      return;
    }
    finalActivityType = normalizedActivityType;
  }
  const finalStatus = dto.status == null ? undefined : normalizeItineraryStatus(String(dto.status));
  const normalizedTravelers = Array.isArray(dto.travelerIds)
    ? dto.travelerIds.map((id: any) => String(id)).filter(Boolean)
    : undefined;
  const updated = await updateActivity(id, userId, {
    activityType: finalActivityType,
    status: finalStatus,
    date: dto.date ?? undefined,
    name: dto.name ?? undefined,
    startLocation: dto.startLocation ?? undefined,
    startTime: dto.startTime ?? undefined,
    duration: dto.duration ?? undefined,
    cost: dto.cost == null ? undefined : Number(dto.cost),
    freeCancelBy: Object.prototype.hasOwnProperty.call(dto, 'freeCancelBy') ? dto.freeCancelBy : undefined,
    bookedOn: dto.bookedOn ?? undefined,
    reference: dto.reference ?? undefined,
    notes: dto.notes ?? undefined,
    paidBy: normalizedPaidBy,
    travelerIds: normalizedTravelers,
  });
  if (!updated) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }
  const membership = await ensureUserInTrip(updated.tripId, userId);
  if (membership) {
    const members = await listGroupMembers(membership.groupId, userId).catch(() => []);
    const defaultTravelers = members.map((m) => String((m as any).id));
    const forIds = normalizedTravelers && normalizedTravelers.length ? normalizedTravelers : defaultTravelers;
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
  if (!(await reserveActivityUsage('ACTIVITIES_ACTIVITY_ROW_WRITE', res))) return;
  const userId = (req as any).user.userId as string;
  const id = req.params.id;
  const dto = readDto(updateActivityDto, req.body ?? {}, res);
  if (!dto) return;

  const normalizedPaidBy = Array.isArray(dto.paidBy)
    ? (dto.paidBy.length ? dto.paidBy.map((p) => String(p)) : undefined)
    : undefined;
  let finalActivityType: ActivityType | undefined;
  if (dto.activityType != null) {
    const normalizedActivityType = normalizeActivityType(dto.activityType);
    if (!normalizedActivityType) {
      res.status(400).json({ error: 'Invalid activityType' });
      return;
    }
    finalActivityType = normalizedActivityType;
  }
  const finalStatus = dto.status == null ? undefined : normalizeItineraryStatus(String(dto.status));
  const normalizedTravelers = Array.isArray(dto.travelerIds)
    ? dto.travelerIds.map((id: any) => String(id)).filter(Boolean)
    : undefined;
  const updated = await updateActivity(id, userId, {
    activityType: finalActivityType,
    status: finalStatus,
    date: dto.date ?? undefined,
    name: dto.name ?? undefined,
    startLocation: dto.startLocation ?? undefined,
    startTime: dto.startTime ?? undefined,
    duration: dto.duration ?? undefined,
    cost: dto.cost == null ? undefined : Number(dto.cost),
    freeCancelBy: dto.freeCancelBy ?? undefined,
    bookedOn: dto.bookedOn ?? undefined,
    reference: dto.reference ?? undefined,
    notes: dto.notes ?? undefined,
    paidBy: normalizedPaidBy,
    travelerIds: normalizedTravelers,
  });
  if (!updated) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }
  const membership = await ensureUserInTrip(updated.tripId, userId);
  if (membership) {
    const members = await listGroupMembers(membership.groupId, userId).catch(() => []);
    const defaultTravelers = members.map((m) => String((m as any).id));
    const forIds = normalizedTravelers && normalizedTravelers.length ? normalizedTravelers : defaultTravelers;
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
  if (!(await reserveActivityUsage('ACTIVITIES_ACTIVITY_ROW_DELETE', res))) return;
  const userId = (req as any).user.userId as string;
  const deleted = await deleteActivity(req.params.id, userId);
  if (!deleted) {
    res.status(404).json({ error: 'Activity not found' });
    return;
  }
  await deleteExpenseForSource('activity', req.params.id, userId);
  res.status(204).send();
});

router.post('/:id/vote', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const dto = readDto(voteOrRatingDto, req.body, res);
  if (!dto) return;
  const value = dto.value;
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
  const dto = readDto(voteOrRatingDto, req.body, res);
  if (!dto) return;
  const value = dto.value;
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

