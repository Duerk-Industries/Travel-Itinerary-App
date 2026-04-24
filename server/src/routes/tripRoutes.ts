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
  listTripMessages,
  acceptTripShareInviteById,
} from '../db';
import { detectCoveringConflict, detectCycle } from '../utils/coveredBy';
import { sendTripInviteEmailBestEffort } from '../mailer';
import { aggregateTripActivity } from '../services/activityFeed';
import { assertCanUseFeature, assertUnderActiveTripLimit, getLimit, recordUsage } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { TokenPayload } from '../auth';
import { readDto } from '../utils/dtoParse';
import {
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
  const { name, groupId, description, locationIds, startDate, endDate, startMonth, startYear, durationDays, currency } = req.body ?? {};
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
      destination: null,
      locationIds: normalizeLocationIds(locationIds),
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
  const { name, description, locationIds, startDate, endDate, startMonth, startYear, durationDays, participants, currency } = req.body ?? {};
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
      destination: null,
      locationIds: normalizeLocationIds(locationIds),
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

router.patch('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const { description, locationIds, startDate, endDate, startMonth, startYear, durationDays, dateMode, currency } = req.body ?? {};
  if (description == null && locationIds == null && startDate == null && endDate == null && startMonth == null && startYear == null && durationDays == null && currency == null) {
    res.status(400).json({ error: 'At least one field is required' });
    return;
  }
  try {
    if (role !== 'admin' && isPastUtcDate(typeof endDate === 'string' ? endDate : null)) {
      res.status(403).json({ error: 'Non-admin users cannot update a trip to end in the past.' });
      return;
    }
    const updated = await updateTripDetails(userId, req.params.id, {
      description: typeof description === 'string' ? description : null,
      destination: null,
      locationIds: locationIds == null ? undefined : normalizeLocationIds(locationIds),
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
