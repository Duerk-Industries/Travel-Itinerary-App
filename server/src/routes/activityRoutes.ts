import { Router, type Response } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  createCatalogActivity,
  copyPublicActivity,
  undoCatalogActivity,
  castItemVote,
  deleteExpenseForSource,
  deleteActivity,
  ensureUserInTrip,
  getItemVoteSummaries,
  getActivityById,
  getLodgingById,
  insertActivity,
  listGroupMembers,
  listActivities,
  reorderActivitiesForDay,
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
import { HttpRateLimitExceededError, reserveHttpRateLimitOrThrow, reserveActivitiesBulkSaveRateLimit } from '../services/httpRateLimitService';
import { z } from 'zod';
import { PlanningError } from '../services/planningOperations';
import { findNearbyPlaces } from '../services/nearbyPlacesService';
import { notify } from '../services/notificationService';

const ACTIVITY_TYPES: ActivityType[] = [
  'Class',
  'Concert/Show',
  'Day Trip',
  'Event',
  'Food & Drink',
  'Fun & Games',
  'Hike',
  'Nightlife',
  'Other',
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

// A completion event is the durable signal for the recap prompt. It intentionally fires only on
// a transition (not every subsequent edit of an already-completed activity), and honors the
// master rollout flag before creating any notification work.
const notifyActivityCompleted = async (previous: any, updated: any, membership: any, actorUserId: string): Promise<void> => {
  if (!previous || !updated || normalizeItineraryStatus(previous.status) === 'Completed' || normalizeItineraryStatus(updated.status) !== 'Completed') return;
  if (!(await isFeatureEnabled('activity_recap'))) return;
  const members = await listGroupMembers(membership.groupId, actorUserId).catch(() => []);
  const userIds = Array.from(new Set(members.map((member: any) => String(member.userId ?? member.user_id ?? '')).filter(Boolean)));
  if (!userIds.length) return;
  const name = String(updated.name || 'this activity').trim() || 'this activity';
  await notify({
    userIds,
    category: 'activity_recap',
    tripId: updated.tripId,
    actorUserId,
    title: `How was ${name}?`,
    body: 'Rate the activity and add photos, videos, or a note to the trip blog.',
    deepLink: `wanderbunnies://activity-recap?tripId=${encodeURIComponent(String(updated.tripId))}&activityId=${encodeURIComponent(String(updated.id))}`,
    payload: { type: 'activity_recap', tripId: updated.tripId, activityId: updated.id },
    dedupeKey: `activity-recap:${updated.id}`,
  });
};

router.get('/nearby', async (req, res) => {
  const query = z.object({ tripId: z.string().uuid(), lat: z.coerce.number().finite().min(-90).max(90).optional(), lng: z.coerce.number().finite().min(-180).max(180).optional(), area: z.string().trim().max(120).optional(), offset: z.coerce.number().int().min(0).max(100).default(0) }).safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: 'Choose a trip and valid map area.' }); return; }
  try {
    if (!(await isFeatureEnabled('planning_nearby', (req as any).user.userId))) { res.status(404).json({ error: 'Nearby is currently unavailable.' }); return; }
    const userId = (req as any).user.userId as string;
    if (!(await ensureUserInTrip(query.data.tripId, userId))) { res.status(403).json({ error: 'Trip unavailable.' }); return; }
    await reserveHttpRateLimitOrThrow({ name: 'nearby_browse', identity: userId, limit: 60, windowMs: 60_000 });
    res.json(await findNearbyPlaces(userId, query.data.tripId, query.data, query.data.offset));
  } catch (error) { res.status(error instanceof HttpRateLimitExceededError ? 429 : 503).json({ error: 'Nearby could not load. Please try again.' }); }
});

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

const nearLodgingIsValid = async (tripId: string, lodgingId?: string | null): Promise<boolean> => {
  const id = lodgingId?.trim();
  if (!id) return true;
  if (!z.uuid().safeParse(id).success) return false;
  const lodging = await getLodgingById(id);
  return (lodging?.tripId ?? lodging?.trip_id) === tripId;
};

router.post('/', async (req, res) => {
  if (req.body?.publicSource !== undefined) {
    const data = z.object({ tripId: z.string().uuid(), date: z.iso.date(),
      publicSource: z.object({ username: z.string().regex(/^[a-z0-9-]{1,80}$/), tripSlug: z.string().regex(/^[a-z0-9-]{1,80}$/), activityId: z.string().uuid() }).strict() }).strict().safeParse(req.body);
    const key = req.get('Idempotency-Key');
    if (!data.success || !key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) { res.status(400).json({ error: 'Choose a shared activity and a valid trip day.' }); return; }
    const userId = (req as any).user.userId as string;
    try {
      if (!(await isFeatureEnabled('planning_trip_inspiration', userId))) { res.status(404).json({ error: 'Trips like this is unavailable.' }); return; }
      await reserveHttpRateLimitOrThrow({ name: 'public_activity_copy', identity: userId, limit: 30, windowMs: 60_000 });
      const result = await copyPublicActivity(userId, { ...data.data, operationKey: key });
      if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(201).json(result.activity);
    } catch (error) {
      res.status(error instanceof PlanningError ? error.status : error instanceof HttpRateLimitExceededError ? 429 : 503)
        .json({ error: error instanceof PlanningError ? error.message : 'Could not copy this activity. Please retry.', code: error instanceof PlanningError ? error.code : 'TEMPORARY_FAILURE' });
    }
    return;
  }
  if (req.body?.catalogId !== undefined) {
    const data = z.object({ tripId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), catalogId: z.string().min(1).max(200) }).safeParse(req.body);
    const key = req.get('Idempotency-Key');
    if (!data.success || !key || !/^[a-zA-Z0-9_-]{16,128}$/.test(key)) { res.status(400).json({ error: 'Choose a place, trip and day.' }); return; }
    try {
      if (!(await isFeatureEnabled('planning_nearby', (req as any).user.userId))) { res.status(404).json({ error: 'Nearby is currently unavailable.' }); return; }
      const result = await createCatalogActivity((req as any).user.userId, { ...data.data, operationKey: key });
      if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(201).json(result.activity);
    } catch (error) {
      res.status(error instanceof PlanningError ? error.status : 503).json({ error: error instanceof PlanningError ? error.message : 'Could not add this place. Please retry.', code: error instanceof PlanningError ? error.code : 'TEMPORARY_FAILURE' });
    }
    return;
  }

  if (!(await reserveActivityUsage('ACTIVITIES_ACTIVITY_ROW_WRITE', res))) return;
  const userId = (req as any).user.userId as string;
  const dto = readDto(createActivityDto, req.body, res);
  if (!dto) return;
  const activityType = normalizeActivityType(dto.activityType) ?? 'Tour';
  const status = normalizeItineraryStatus(dto.status);
  const relaxed = shouldRelaxRequiredFields(status);
  const dateVal = dto.date ?? '';
  const nameVal = dto.name ?? '';
  if (!relaxed && !nameVal) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const tripGroup = await ensureUserInTrip(dto.tripId, userId);
  if (!tripGroup) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const nearLodgingId = dto.nearLodgingId?.trim() || null;
  if (!(await nearLodgingIsValid(dto.tripId, nearLodgingId))) {
    res.status(400).json({ error: 'Choose a hotel from this trip.' });
    return;
  }
  const activity = await insertActivity({
    userId,
    tripId: dto.tripId,
    status,
    activityType,
    date: dateVal,
    nearLodgingId,
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
  if (dateVal) await upsertExpenseForSource({
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
    await reserveActivitiesBulkSaveRateLimit(userId, req.ip || req.socket.remoteAddress);
  } catch (err) {
    if (err instanceof HttpRateLimitExceededError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
      res.status(429).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
    return;
  }
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
      const previous = await getActivityById(update.id);
      const fields = update.fields;
      if (previous && !(await nearLodgingIsValid(previous.tripId, fields.nearLodgingId))) throw new Error('Choose a hotel from this trip.');
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
        date: fields.date === undefined ? undefined : fields.date ?? '',
        nearLodgingId: fields.nearLodgingId === undefined ? undefined : fields.nearLodgingId?.trim() || null,
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
        if (!updated.date) await deleteExpenseForSource('activity', updated.id, userId);
        else await upsertExpenseForSource({
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
        await notifyActivityCompleted(previous, updated, membership, userId);
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

const dayOrderDto = z.object({
  tripId: z.string().uuid(),
  date: z.iso.date(),
  // The order the client was looking at. A mismatch means someone else changed the day first.
  expectedIds: z.array(z.string().min(1).max(64)).max(100),
  orderedIds: z.array(z.string().min(1).max(64)).max(100),
  pinnedIds: z.array(z.string().min(1).max(64)).max(100).optional(),
  expectedPinnedIds: z.array(z.string().min(1).max(64)).max(100).optional(),
}).refine(value => (value.pinnedIds === undefined) === (value.expectedPinnedIds === undefined));

// Registered before '/:id' so "day-order" is never read as an activity id.
router.put('/day-order', async (req, res) => {
  const dto = dayOrderDto.safeParse(req.body ?? {});
  if (!dto.success) { res.status(400).json({ error: 'Choose a trip, a day and the new order.', code: 'INVALID_DAY_ORDER' }); return; }
  const userId = (req as any).user.userId as string;
  try {
    if (!(await isFeatureEnabled('planning_day_order', userId))) { res.status(404).json({ error: 'Reordering is currently unavailable.', code: 'FEATURE_DISABLED' }); return; }
    await reserveHttpRateLimitOrThrow({ name: 'activity_day_order', identity: userId, limit: 60, windowMs: 60_000 });
    const { tripId, date, orderedIds, expectedIds, pinnedIds, expectedPinnedIds } = dto.data;
    const outcome = await reorderActivitiesForDay(userId, tripId, date, orderedIds, expectedIds,
      pinnedIds ? { pinnedIds, expectedPinnedIds: expectedPinnedIds! } : undefined);
    if (outcome.ok) { res.json({ order: outcome.order }); return; }
    if (outcome.reason === 'forbidden') { res.status(403).json({ error: 'You must be in the group for this trip.' }); return; }
    res.status(409).json({
      error: outcome.reason === 'stale'
        ? 'This day was changed by someone else. Review the new order and try again.'
        : 'The new order does not match this day\'s activities.',
      code: outcome.reason === 'stale' ? 'DAY_ORDER_STALE' : 'DAY_ORDER_MISMATCH',
      currentOrder: outcome.currentOrder,
    });
  } catch (error) {
    if (error instanceof HttpRateLimitExceededError) { res.setHeader('Retry-After', String(error.retryAfterSeconds)); res.status(429).json({ error: error.message }); return; }
    res.status(503).json({ error: 'The order could not be saved. Please try again.' });
  }
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
  const previous = await getActivityById(id);
  if (previous && !(await nearLodgingIsValid(previous.tripId, dto.nearLodgingId))) {
    res.status(400).json({ error: 'Choose a hotel from this trip.' });
    return;
  }
  const normalizedTravelers = Array.isArray(dto.travelerIds)
    ? dto.travelerIds.map((id: any) => String(id)).filter(Boolean)
    : undefined;
  const updated = await updateActivity(id, userId, {
    activityType: finalActivityType,
    status: finalStatus,
    date: dto.date === undefined ? undefined : dto.date ?? '',
    nearLodgingId: dto.nearLodgingId === undefined ? undefined : dto.nearLodgingId?.trim() || null,
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
    if (!updated.date) await deleteExpenseForSource('activity', updated.id, userId);
    else await upsertExpenseForSource({
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
    await notifyActivityCompleted(previous, updated, membership, userId);
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
  const previous = await getActivityById(id);
  if (previous && !(await nearLodgingIsValid(previous.tripId, dto.nearLodgingId))) {
    res.status(400).json({ error: 'Choose a hotel from this trip.' });
    return;
  }
  const normalizedTravelers = Array.isArray(dto.travelerIds)
    ? dto.travelerIds.map((id: any) => String(id)).filter(Boolean)
    : undefined;
  const updated = await updateActivity(id, userId, {
    activityType: finalActivityType,
    status: finalStatus,
    date: dto.date === undefined ? undefined : dto.date ?? '',
    nearLodgingId: dto.nearLodgingId === undefined ? undefined : dto.nearLodgingId?.trim() || null,
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
    if (!updated.date) await deleteExpenseForSource('activity', updated.id, userId);
    else await upsertExpenseForSource({
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
    await notifyActivityCompleted(previous, updated, membership, userId);
  }
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const operationKey = req.get('Idempotency-Key');
  if (operationKey) {
    try { await undoCatalogActivity((req as any).user.userId, String(req.params.id), operationKey); res.status(204).end(); }
    catch (error) { res.status(error instanceof PlanningError ? error.status : 503).json({ error: error instanceof PlanningError ? error.message : 'Could not undo this addition.' }); }
    return;
  }

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

router.post('/:id/vote', (_req, res) => {
  res.status(410).json({ error: 'Proposal voting is no longer available' });
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

