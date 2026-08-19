import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  acceptTripShareInvite,
  addTripComment,
  createTripShareInvite,
  createFellowTraveler,
  createTrip,
  createTripWithGroupAndMembers,
  deleteTrip,
  ensureUserCanReadTrip,
  followTripByCode,
  getTripById,
  getTripCovering,
  getTripFollowCode,
  getTripPackingList,
  listFollowedTrips,
  listPendingTripShareInvitesForUser,
  listTripComments,
  listTripActivity,
  listTrips,
  listTripShareInvites,
  rejectTripShareInvite,
  revokeTripShareInvite,
  searchTripContacts,
  unfollowTrip,
  updateTripCovering,
  updateTripDetails,
  updateTripGroup,
  replaceTripPackingList,
  setTripPackingItemPacked,
  getPackingListV2,
  addTripPackingPresetV2,
  removeTripPackingPresetV2,
  setTripPackingSourceV2,
  replaceTripPackingListV2,
  addTripPackingItemV2,
  removeTripPackingItemV2,
  listTripMessages,
  acceptTripShareInviteById,
} from '../db';
import { isFeatureEnabled } from '../services/entitlementService';
import { detectCoveringConflict, detectCycle } from '../utils/coveredBy';
import { sendTripInviteEmailBestEffort } from '../mailer';
import { aggregateTripActivity } from '../services/activityFeed';
import { assertCanUseFeature, assertUnderActiveTripLimit, getLimit, recordUsage } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { manualUploadMiddleware, buildManualUploadPayloads } from '../ingestion/intake';
import { IngestionError } from '../ingestion/shared/userFailures';
import { ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY } from '../services/itineraryDocumentImportService';
import { enqueueAsyncDocumentImportJob, getAsyncDocumentImportJob } from '../services/documentImportAsyncService';
import { TokenPayload } from '../auth';
import { readDto } from '../utils/dtoParse';
import {
  bulkDeleteShareInvitesDto,
  createShareInvitesDto,
  createTripCommentDto,
  followTripDto,
  updateCoveredByDto,
  updateTripGroupDto,
} from './tripDtos';

const normalizeLocationIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids = value.map((id) => String(id ?? '').trim()).filter(Boolean);
  return Array.from(new Set(ids));
};

const normalizeMustSeeAttractions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const names = value.map((name) => String(name ?? '').trim()).filter(Boolean);
  return Array.from(new Set(names));
};

const parseActivityCursor = (raw: unknown): { createdAt: string; id: string } | null => {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const [createdAt, id] = value.split('::');
  if (!createdAt || !id) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return { createdAt: date.toISOString(), id };
};

const parseGroupParam = (raw: unknown): boolean => {
  if (typeof raw === 'undefined') return true;
  const value = String(raw).trim().toLowerCase();
  if (value === 'false' || value === '0' || value === 'no') return false;
  return true;
};

const getTodayUtcDate = (): string => new Date().toISOString().slice(0, 10);
const isPastUtcDate = (value?: string | null): boolean => Boolean(value && value < getTodayUtcDate());

// Trips API: create/list/delete trips for the authenticated user.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

// Following is not yet implemented server-side; return empty data instead of 404s for client calls.
router.get('/followed', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const trips = await listFollowedTrips(userId);
  res.json(trips);
});

router.post('/follow', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const dto = readDto(followTripDto, req.body, res);
  if (!dto) return;
  try {
    await assertCanUseFeature(userId, 'trip_following', role);
    const result = await followTripByCode(userId, dto.inviteCode);
    res.status(result.alreadyFollowing ? 200 : 201).json({
      trip: result.trip,
      inviterName: result.inviterName,
      alreadyFollowing: result.alreadyFollowing,
      todayDetails: [],
    });
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    const message = (err as Error).message;
    if (/invalid|expired/i.test(message)) {
      res.status(404).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.get('/share/invites/pending', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const email = (req as any).user.email as string | undefined;
  try {
    const invites = await listPendingTripShareInvitesForUser(userId, email);
    res.json({ invites });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Unable to load pending invites' });
  }
});

router.post('/share/invites/:inviteId/accept', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const email = (req as any).user.email as string | undefined;
  if (!email) {
    res.status(400).json({ error: 'Authenticated email is required' });
    return;
  }
  try {
    const accepted = await acceptTripShareInviteById(userId, email, req.params.inviteId);
    res.status(200).json(accepted);
  } catch (err) {
    const message = (err as Error).message;
    if (/not found|expired|pending|match/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: message || 'Unable to accept invite' });
  }
});

router.post('/share/invites/:inviteId/reject', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const email = (req as any).user.email as string | undefined;
  if (!email) {
    res.status(400).json({ error: 'Authenticated email is required' });
    return;
  }
  try {
    await rejectTripShareInvite(userId, email, req.params.inviteId);
    res.status(204).send();
  } catch (err) {
    const message = (err as Error).message;
    if (/not found/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: message || 'Unable to reject invite' });
  }
});

router.post('/share/invites/:token/accept', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const email = (req as any).user.email as string | undefined;
  const token = String(req.params.token ?? '').trim();
  if (!token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  if (!email) {
    res.status(400).json({ error: 'Authenticated email is required' });
    return;
  }
  try {
    const accepted = await acceptTripShareInvite(userId, email, token);
    res.status(200).json(accepted);
  } catch (err) {
    const message = (err as Error).message;
    if (/not found|expired|pending|match/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: message || 'Unable to accept invite' });
  }
});

router.get('/:id/follow-code', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    const code = await getTripFollowCode(userId, req.params.id);
    res.json({ inviteCode: code.code, tripId: code.tripId, id: code.id, status: code.status });
  } catch (err) {
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.get('/:id/share/meta', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    const code = await getTripFollowCode(userId, req.params.id);
    const invites = await listTripShareInvites(userId, req.params.id);
    res.json({
      tripId: req.params.id,
      followCode: code.code,
      followCodeStatus: code.status,
      invites,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.get('/:id/share/invites', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    const invites = await listTripShareInvites(userId, req.params.id);
    res.json({ tripId: req.params.id, invites });
  } catch (err) {
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.post('/:id/share/invites', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const dto = readDto(createShareInvitesDto, req.body, res);
  if (!dto) return;

  try {
    await assertCanUseFeature(userId, 'trip_sharing', role);
    const created = await Promise.all(
      dto.invites.map((invite) =>
        createTripShareInvite(userId, req.params.id, invite.email, invite.role)
      )
    );
    res.status(201).json({
      tripId: req.params.id,
      invites: created.map((result) => ({
        ...result.invite,
        token: result.token ?? null,
        autoApplied: result.autoApplied,
      })),
    });
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.delete('/:id/share/invites/:inviteId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await revokeTripShareInvite(userId, req.params.id, req.params.inviteId);
    res.status(204).send();
  } catch (err) {
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

/**
 * Bulk revoke share invites. Mirrors the ingestion bulk-action pattern:
 * 100-id cap, dedupe, per-id try/catch, 207 Multi-Status when any id fails.
 * If the caller isn't authorized on the trip at all, the underlying
 * `revokeTripShareInvite` throws "not authorized" for every id and we
 * surface that as 403 without writing the 207 mixed response.
 */
router.post('/:id/share/invites/bulk-delete', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const dto = readDto(bulkDeleteShareInvitesDto, req.body, res);
  if (!dto) return;

  const revoked: Array<{ id: string }> = [];
  const failed: Array<{ id: string; reason: string }> = [];
  let anyAuthorized = false;

  for (const inviteId of dto.ids) {
    try {
      await revokeTripShareInvite(userId, req.params.id, inviteId);
      revoked.push({ id: inviteId });
      anyAuthorized = true;
    } catch (err) {
      const message = String((err as Error).message ?? 'Invite revocation failed');
      failed.push({ id: inviteId, reason: message });
      if (!/not authorized/i.test(message)) {
        anyAuthorized = true;
      }
    }
  }

  // If every id failed with "not authorized", fold into a single 403 — the
  // caller isn't allowed on this trip at all and a 207 mix would be
  // misleading.
  if (!anyAuthorized && failed.length && revoked.length === 0) {
    res.status(403).json({ error: failed[0].reason });
    return;
  }

  res.status(failed.length > 0 ? 207 : 200).json({
    tripId: req.params.id,
    revokedIds: revoked.map((r) => r.id),
    failed,
  });
});

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const trips = await listTrips(userId);
  res.json(trips);
});

router.get('/participants/search', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const results = await searchTripContacts(userId, q);
  res.json(results);
});

router.get('/:id/packing-list', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    if (await isFeatureEnabled('packing_lists_v2')) {
      res.json(await getPackingListV2(userId, req.params.id));
      return;
    }
    const list = await getTripPackingList(userId, req.params.id);
    res.json(list);
  } catch (err) {
    const message = (err as Error).message;
    res.status(/not authorized/i.test(message) ? 403 : 400).json({ error: message });
  }
});

router.put('/:id/packing-list', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    if (await isFeatureEnabled('packing_lists_v2')) {
      res.json(await replaceTripPackingListV2(userId, req.params.id, Array.isArray(req.body?.items) ? req.body.items : []));
      return;
    }
    const list = await replaceTripPackingList(userId, req.params.id, Array.isArray(req.body?.items) ? req.body.items : []);
    res.json(list);
  } catch (err) {
    const message = (err as Error).message;
    res.status(/not authorized/i.test(message) ? 403 : 400).json({ error: message });
  }
});

router.post('/:id/packing-list/presets', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    if (!(await isFeatureEnabled('packing_lists_v2'))) {
      res.status(404).json({ error: 'Packing lists v2 is not enabled' });
      return;
    }
    res.json(await addTripPackingPresetV2(userId, req.params.id, String(req.body?.presetKey ?? '').trim()));
  } catch (err) {
    const message = (err as Error).message;
    res.status(/not authorized/i.test(message) ? 403 : 400).json({ error: message });
  }
});

router.delete('/:id/packing-list/presets/:presetKey', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    if (!(await isFeatureEnabled('packing_lists_v2'))) {
      res.status(404).json({ error: 'Packing lists v2 is not enabled' });
      return;
    }
    res.json(await removeTripPackingPresetV2(userId, req.params.id, req.params.presetKey));
  } catch (err) {
    const message = (err as Error).message;
    res.status(/not authorized/i.test(message) ? 403 : 400).json({ error: message });
  }
});

router.patch('/:id/packing-list/sources', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    if (!(await isFeatureEnabled('packing_lists_v2'))) {
      res.status(404).json({ error: 'Packing lists v2 is not enabled' });
      return;
    }
    const kind = req.body?.kind === 'personal' ? 'personal' : req.body?.kind === 'preset' ? 'preset' : null;
    const key = String(req.body?.key ?? '').trim();
    if (!kind || !key || typeof req.body?.enabled !== 'boolean') {
      res.status(400).json({ error: 'A packing source kind, key, and enabled value are required' });
      return;
    }
    res.json(await setTripPackingSourceV2(userId, req.params.id, kind, key, req.body.enabled));
  } catch (err) {
    const message = (err as Error).message;
    res.status(/not authorized/i.test(message) ? 403 : 400).json({ error: message });
  }
});

router.post('/:id/packing-list/items', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    if (!(await isFeatureEnabled('packing_lists_v2'))) {
      res.status(404).json({ error: 'Packing lists v2 is not enabled' });
      return;
    }
    res.json(await addTripPackingItemV2(userId, req.params.id, req.body ?? {}));
  } catch (err) {
    const message = (err as Error).message;
    res.status(/not authorized/i.test(message) ? 403 : 400).json({ error: message });
  }
});

router.delete('/:id/packing-list/items/:itemId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    if (!(await isFeatureEnabled('packing_lists_v2'))) {
      res.status(404).json({ error: 'Packing lists v2 is not enabled' });
      return;
    }
    res.json(await removeTripPackingItemV2(userId, req.params.id, req.params.itemId));
  } catch (err) {
    const message = (err as Error).message;
    res.status(/not authorized/i.test(message) ? 403 : 400).json({ error: message });
  }
});

router.patch('/:id/packing-list/checks', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const itemId = String(req.body?.itemId ?? '').trim();
  const travelerId = String(req.body?.travelerId ?? '').trim();
  const packed = Boolean(req.body?.packed);
  if (!itemId || !travelerId) {
    res.status(400).json({ error: 'itemId and travelerId are required' });
    return;
  }
  try {
    await setTripPackingItemPacked(userId, req.params.id, itemId, travelerId, packed);
    res.status(204).send();
  } catch (err) {
    const message = (err as Error).message;
    res.status(/not authorized/i.test(message) ? 403 : 400).json({ error: message });
  }
});

router.get('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const access = await ensureUserCanReadTrip(req.params.id, userId);
  if (!access) {
    res.status(403).json({ error: 'Not authorized to view this trip' });
    return;
  }
  const trip = await getTripById(req.params.id);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  res.json({ ...trip, access: access.access });
});

router.get('/:id/activity', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const access = await ensureUserCanReadTrip(req.params.id, userId);
  if (!access) {
    res.status(403).json({ error: 'Not authorized to view this trip activity' });
    return;
  }

  const rawLimit = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
  const cursor = parseActivityCursor(req.query.cursor);
  const grouped = parseGroupParam(req.query.group);
  if (req.query.cursor && !cursor) {
    res.status(400).json({ error: 'Invalid cursor format' });
    return;
  }

  const result = await listTripActivity(req.params.id, { limit, cursor });
  const events = grouped ? aggregateTripActivity(result.events) : result.events;
  res.json({
    tripId: req.params.id,
    grouped,
    events,
    nextCursor: result.nextCursor,
  });
});

router.get('/:id/comments', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const access = await ensureUserCanReadTrip(req.params.id, userId);
  if (!access) {
    res.status(403).json({ error: 'Not authorized to view this trip comments' });
    return;
  }
  const comments = await listTripComments(req.params.id);
  res.json({ tripId: req.params.id, comments });
});

router.post('/:id/comments', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const access = await ensureUserCanReadTrip(req.params.id, userId);
  if (!access) {
    res.status(403).json({ error: 'Not authorized to comment on this trip' });
    return;
  }
  const dto = readDto(createTripCommentDto, req.body, res);
  if (!dto) return;
  try {
    const comment = await addTripComment(req.params.id, userId, dto.body);
    res.status(201).json(comment);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/:id/messages', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const access = await ensureUserCanReadTrip(req.params.id, userId);
  if (!access) {
    res.status(403).json({ error: 'Not authorized to view messages for this trip' });
    return;
  }
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  const messages = await listTripMessages(req.params.id, limit);
  res.json({ tripId: req.params.id, messages });
});

router.get('/:id/covered-by', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    const coveredBy = await getTripCovering(userId, req.params.id);
    res.json(coveredBy || {});
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/:id/covered-by', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const coveredBy = readDto(updateCoveredByDto, req.body ?? {}, res);
  if (!coveredBy) return;
  if (detectCycle(coveredBy)) {
    res.status(400).json({ error: 'Invalid covering rules: circular dependency detected.' });
    return;
  }
  if (detectCoveringConflict(coveredBy)) {
    res
      .status(400)
      .json({ error: 'Invalid covering rules: a traveler who covers someone cannot be covered by another traveler.' });
    return;
  }
  try {
    const updated = await updateTripCovering(userId, req.params.id, coveredBy);
    res.json(updated || {});
  } catch (err) {
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const { name, groupId, description, notes, locationIds, mustSeeAttractions, startDate, endDate, startMonth, startYear, durationDays, currency } = req.body ?? {};
  if (!name || !groupId) {
    res.status(400).json({ error: 'name and groupId are required' });
    return;
  }
  try {
    await assertCanUseFeature(userId, 'trip_creation', role);
    if (role !== 'admin' && isPastUtcDate(typeof endDate === 'string' ? endDate : null)) {
      res.status(403).json({ error: 'Non-admin users cannot create trips that end in the past.' });
      return;
    }
    await assertUnderActiveTripLimit(userId, role);
    const trip = await createTrip(userId, groupId, name.trim(), {
      description: typeof description === 'string' ? description.trim() || null : null,
      notes: typeof notes === 'string' ? notes.trim() || null : null,
      destination: null,
      locationIds: normalizeLocationIds(locationIds),
      mustSeeAttractions: normalizeMustSeeAttractions(mustSeeAttractions),
      startDate: typeof startDate === 'string' ? startDate : null,
      endDate: typeof endDate === 'string' ? endDate : null,
      startMonth: Number.isFinite(Number(startMonth)) ? Number(startMonth) : null,
      startYear: Number.isFinite(Number(startYear)) ? Number(startYear) : null,
      durationDays: Number.isFinite(Number(durationDays)) ? Number(durationDays) : null,
      currency: typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'USD',
    });
    await recordUsage(userId, 'trip_creations', 1, { windowKey: 'all-time', tripId: trip.id });
    res.status(201).json(trip);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    const message = (err as Error).message;
    if (/log in again/i.test(message) || /user not found/i.test(message)) {
      res.status(401).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.post('/wizard', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const { name, description, notes, locationIds, mustSeeAttractions, startDate, endDate, startMonth, startYear, durationDays, participants, currency } = req.body ?? {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Trip name is required' });
    return;
  }
  const memberInputs = Array.isArray(participants) ? participants : [];
  for (const p of memberInputs) {
    if (!p?.firstName || !p?.lastName) {
      res.status(400).json({ error: 'Each participant needs a first and last name' });
      return;
    }
  }
  const emails = memberInputs
    .map((p) => String(p.email ?? '').trim().toLowerCase())
    .filter(Boolean);
  const unique = new Set(emails);
  if (unique.size !== emails.length) {
    res.status(400).json({ error: 'Participant emails must be unique' });
    return;
  }

  const members = memberInputs.map((p) => {
    const email = String(p.email ?? '').trim().toLowerCase();
    const guestName = `${String(p.firstName ?? '').trim()} ${String(p.lastName ?? '').trim()}`.trim();
    return email ? { email, guestName: guestName || undefined } : { guestName };
  });

  try {
    await assertCanUseFeature(userId, 'trip_creation', role);
    if (role !== 'admin' && isPastUtcDate(typeof endDate === 'string' ? endDate : null)) {
      res.status(403).json({ error: 'Non-admin users cannot create trips that end in the past.' });
      return;
    }
    const travelerLimit = await getLimit(userId, 'max_travelers_per_trip');
    if (
      role !== 'admin' &&
      Number.isFinite(travelerLimit) &&
      typeof travelerLimit === 'number' &&
      memberInputs.length + 1 > travelerLimit
    ) {
      throw new EntitlementError(
        'TIER_LIMIT_REACHED',
        `You have reached the traveler limit of ${travelerLimit} for your current plan`,
        { limitKey: 'max_travelers_per_trip' }
      );
    }
    await assertUnderActiveTripLimit(userId, role);
    const result = await createTripWithGroupAndMembers({
      ownerId: userId,
      tripName: String(name).trim(),
      description: typeof description === 'string' ? description.trim() || null : null,
      notes: typeof notes === 'string' ? notes.trim() || null : null,
      destination: null,
      locationIds: normalizeLocationIds(locationIds),
      mustSeeAttractions: normalizeMustSeeAttractions(mustSeeAttractions),
      startDate: typeof startDate === 'string' ? startDate : null,
      endDate: typeof endDate === 'string' ? endDate : null,
      startMonth: Number.isFinite(Number(startMonth)) ? Number(startMonth) : null,
      startYear: Number.isFinite(Number(startYear)) ? Number(startYear) : null,
      durationDays: Number.isFinite(Number(durationDays)) ? Number(durationDays) : null,
      currency: typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'USD',
      members,
    });
    await recordUsage(userId, 'trip_creations', 1, { windowKey: 'all-time', tripId: result.trip.id });

    for (const p of memberInputs) {
      const email = String(p.email ?? '').trim();
      if (!email) {
        const firstName = String(p.firstName ?? '').trim();
        const lastName = String(p.lastName ?? '').trim();
        if (firstName && lastName) {
          await createFellowTraveler(userId, firstName, lastName);
        }
      }
    }

    const ownerEmail = (req as any).user?.email as string | undefined;
    const tripName = result.trip?.name ?? String(name).trim();
    const inviteEmails = memberInputs.map((p) => String(p.email ?? '').trim()).filter(Boolean);
    const uniqueEmails = Array.from(new Set(inviteEmails));
    await Promise.all(
      uniqueEmails.map((inviteEmail) =>
        sendTripInviteEmailBestEffort(inviteEmail, tripName, ownerEmail ?? null).catch(() => undefined)
      )
    );

    res.status(201).json({ trip: result.trip, groupId: result.groupId, invites: result.invites });
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteTrip(userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

router.delete('/:id/follow', async (req, res) => {
  const userId = (req as any).user.userId as string;
  await unfollowTrip(userId, req.params.id);
  res.status(204).send();
});

router.patch('/:id/group', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const dto = readDto(updateTripGroupDto, req.body, res);
  if (!dto) return;
  try {
    const updated = await updateTripGroup(userId, req.params.id, dto.groupId);
    res.json(updated);
  } catch (err) {
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

// Normalization (OCR / PDF text extraction) and LLM extraction both run in
// the background job below rather than inline here. Firebase Hosting's
// rewrite to Cloud Run has a fixed ~60s timeout it enforces regardless of
// Cloud Run's own request timeout, and this pipeline routinely exceeds that
// (observed ~121s end-to-end for a real document) -- Hosting would return its
// own 502 to the browser well before the import finished. Only the fast,
// validating parts (entitlement check, file upload + virus scan) run inline
// so bad requests still fail immediately; the slow parts run as a job the
// client polls via GET below.
router.post('/:tripId/import-document', (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }
  manualUploadMiddleware.single('file')(req, res, next);
}, async (req, res) => {
  const user = (req as any).user as TokenPayload;
  try {
    // Keep entitlement enforcement ahead of normalization and extraction so a denied
    // request cannot consume provider quota.
    await assertCanUseFeature(user.userId, ITINERARY_DOCUMENT_IMPORT_FEATURE_KEY, user.role);

    let documentText = typeof req.body?.documentText === 'string' ? req.body.documentText : '';
    let sourceFilename = typeof req.body?.sourceFilename === 'string' ? req.body.sourceFilename.trim() : '';
    let payload: Awaited<ReturnType<typeof buildManualUploadPayloads>>[number] | undefined;
    if (req.file) {
      const payloads = await buildManualUploadPayloads(req, user.userId);
      payload = payloads[0];
      sourceFilename = payload.originalFilename;
    }
    if (!documentText.trim() && !payload) {
      res.status(400).json({ error: 'Document text or a supported file is required' });
      return;
    }
    const dryRunValue = req.body?.dryRun;
    const dryRun = dryRunValue === true || dryRunValue === 'true' || dryRunValue === '1';
    const job = enqueueAsyncDocumentImportJob({
      tripId: req.params.tripId,
      userId: user.userId,
      documentText: payload ? undefined : documentText,
      payload,
      sourceFilename: sourceFilename || 'pasted text',
      dryRun,
      correlationId: req.get('x-correlation-id') || undefined,
    });
    res.status(202).json({ jobId: job.id, tripId: req.params.tripId, status: job.status });
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof IngestionError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(/character limit/i.test(message) ? 413 : 400).json({ error: message });
  }
});

router.get('/:tripId/import-document/:jobId', async (req, res) => {
  const user = (req as any).user as TokenPayload;
  const job = getAsyncDocumentImportJob(req.params.jobId);
  if (!job || job.userId !== user.userId || job.tripId !== req.params.tripId) {
    res.status(404).json({ error: 'Import job not found' });
    return;
  }
  res.json({
    jobId: job.id,
    tripId: job.tripId,
    status: job.status,
    error: job.error ?? null,
    result: job.result ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

router.patch('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const body = req.body ?? {};
  const { description, notes, locationIds, mustSeeAttractions, startDate, endDate, startMonth, startYear, durationDays, dateMode, currency } = body;
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
  const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
  if (!hasDescription && !hasNotes && locationIds == null && mustSeeAttractions == null && startDate == null && endDate == null && startMonth == null && startYear == null && durationDays == null && currency == null) {
    res.status(400).json({ error: 'At least one field is required' });
    return;
  }
  try {
    if (role !== 'admin' && isPastUtcDate(typeof endDate === 'string' ? endDate : null)) {
      res.status(403).json({ error: 'Non-admin users cannot update a trip to end in the past.' });
      return;
    }
    const updated = await updateTripDetails(userId, req.params.id, {
      ...(hasDescription ? { description: typeof description === 'string' ? description : null } : {}),
      ...(hasNotes ? { notes: typeof notes === 'string' ? notes : null } : {}),
      destination: null,
      locationIds: locationIds == null ? undefined : normalizeLocationIds(locationIds),
      mustSeeAttractions: mustSeeAttractions == null ? undefined : normalizeMustSeeAttractions(mustSeeAttractions),
      startDate: typeof startDate === 'string' ? startDate : null,
      endDate: typeof endDate === 'string' ? endDate : null,
      startMonth: Number.isFinite(Number(startMonth)) ? Number(startMonth) : null,
      startYear: Number.isFinite(Number(startYear)) ? Number(startYear) : null,
      durationDays: Number.isFinite(Number(durationDays)) ? Number(durationDays) : null,
      dateMode: dateMode === 'month' || dateMode === 'range' ? dateMode : undefined,
      currency: typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : null,
    });
    res.json(updated);
  } catch (err) {
    const message = (err as Error).message;
    if (/not authorized/i.test(message)) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
});

export default router;
