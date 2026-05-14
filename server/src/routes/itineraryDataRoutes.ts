import { Router } from 'express';
import bodyParser from 'body-parser';
import { ZodError } from 'zod';
import { authenticate } from '../auth';
import {
  addItineraryChecklistItem,
  addItineraryDetail,
  createItineraryRecord,
  deleteItineraryChecklistItem,
  deleteItineraryDetail,
  deleteItineraryRecord,
  ensureUserCanReadTrip,
  ensureUserInTrip,
  listItineraries,
  listItineraryDetails,
  updateItineraryChecklistItem,
  updateItineraryDetail,
  updateItineraryRecord,
} from '../db';
import type { ItineraryDetailKind } from '../types';
import { isFeatureEnabled } from '../services/entitlementService';
import {
  attachReactionsToDetails,
  getReactionSummaryForDetail,
  REACTION_FEATURE_FLAG,
  removeReaction,
  resolveDetailContext,
  upsertReaction,
} from '../services/itineraryReactionService';
import { castReactionDto } from './itineraryDataDtos';

// Itinerary data helpers: AI-generated plans, search, and summaries.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const items = await listItineraries(userId);
  res.json(items);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { tripId, destination, days, budget } = req.body ?? {};
  if (!tripId || !destination || !days) {
    res.status(400).json({ error: 'tripId, destination, and days are required' });
    return;
  }
  try {
    const created = await createItineraryRecord(userId, tripId, destination, Number(days), budget != null ? Number(budget) : null);
    res.status(201).json(created);
  } catch (err: any) {
    if (err.code === 'ITINERARY_EXISTS') {
      res.status(409).json({ error: err.message });
    } else {
      res.status(400).json({ error: (err as Error).message });
    }
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteItineraryRecord(userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { destination, days, budget } = req.body ?? {};
  if (!destination || !days) {
    res.status(400).json({ error: 'destination and days are required' });
    return;
  }
  try {
    const updated = await updateItineraryRecord(
      userId,
      req.params.id,
      destination,
      Number(days),
      budget != null ? Number(budget) : null
    );
    res.json(updated);
  } catch (err: any) {
    if (err.code === 'ITINERARY_EXISTS') {
      res.status(409).json({ error: err.message });
    } else {
      res.status(400).json({ error: (err as Error).message });
    }
  }
});

router.get('/:id/details', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    const details = await listItineraryDetails(userId, req.params.id);
    const withReactions = await attachReactionsToDetails(userId, details);
    res.json(withReactions);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const ITEM_KINDS_FEATURE_FLAG = 'itinerary_item_kinds';
const VALID_KINDS: ItineraryDetailKind[] = ['activity', 'place', 'note', 'checklist'];

const parseKind = (raw: unknown): ItineraryDetailKind | null => {
  if (raw == null || raw === '') return null;
  const value = String(raw).trim().toLowerCase();
  return (VALID_KINDS as readonly string[]).includes(value) ? (value as ItineraryDetailKind) : null;
};

const parseChecklistInputs = (raw: unknown): Array<{ label: string; position?: number }> | null => {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const out: Array<{ label: string; position?: number }> = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as any;
    if (!item || typeof item !== 'object') return null;
    const label = String(item.label ?? '').trim();
    if (!label) return null;
    const position = item.position != null ? Number(item.position) : undefined;
    if (position != null && !Number.isFinite(position)) return null;
    out.push({ label, position });
  }
  return out;
};

router.post('/:id/details', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const body = req.body ?? {};
  const { day, time, activity, cost } = body;
  const rawKind = body.kind;
  const kindsFeatureOn = await isFeatureEnabled(ITEM_KINDS_FEATURE_FLAG);
  let kind: ItineraryDetailKind = 'activity';
  if (rawKind != null && rawKind !== '') {
    if (!kindsFeatureOn) {
      res.status(403).json({ error: 'Itinerary item kinds are currently disabled', code: 'FEATURE_DISABLED' });
      return;
    }
    const parsed = parseKind(rawKind);
    if (!parsed) {
      res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
      return;
    }
    kind = parsed;
  }

  if (!day || !activity) {
    res.status(400).json({ error: 'day and activity are required' });
    return;
  }

  let checklistItems: Array<{ label: string; position?: number }> | undefined;
  if (kind === 'checklist') {
    const parsed = parseChecklistInputs(body.checklistItems);
    if (parsed === null) {
      res.status(400).json({ error: 'checklistItems must be an array of { label } entries with non-empty labels' });
      return;
    }
    checklistItems = parsed;
  }

  try {
    const created = await addItineraryDetail(userId, req.params.id, {
      day: Number(day),
      time: time ?? null,
      activity,
      cost: cost != null ? Number(cost) : null,
      kind,
      placeId: body.placeId != null ? String(body.placeId).trim() || null : null,
      noteBody: body.noteBody != null ? String(body.noteBody) : null,
      position: body.position != null ? Number(body.position) : undefined,
      checklistItems,
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/details/:detailId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteItineraryDetail(userId, req.params.detailId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/details/:detailId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const body = req.body ?? {};
  const { day, time, activity, cost } = body;
  if (!activity) {
    res.status(400).json({ error: 'activity is required' });
    return;
  }
  try {
    const updated = await updateItineraryDetail(userId, req.params.detailId, {
      day: day != null ? Number(day) : undefined,
      time: time ?? null,
      activity,
      cost: cost != null ? Number(cost) : null,
      placeId: body.placeId !== undefined ? (body.placeId == null ? null : String(body.placeId)) : undefined,
      noteBody: body.noteBody !== undefined ? (body.noteBody == null ? null : String(body.noteBody)) : undefined,
      position: body.position != null ? Number(body.position) : undefined,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Checklist child items for kind='checklist' itinerary details.
// All write paths require full trip membership and the feature flag.
// ---------------------------------------------------------------------------
router.post('/details/:detailId/checklist-items', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await isFeatureEnabled(ITEM_KINDS_FEATURE_FLAG))) {
    res.status(403).json({ error: 'Itinerary item kinds are currently disabled', code: 'FEATURE_DISABLED' });
    return;
  }
  const body = req.body ?? {};
  const label = String(body.label ?? '').trim();
  if (!label) {
    res.status(400).json({ error: 'label is required' });
    return;
  }
  const position = body.position != null ? Number(body.position) : undefined;
  if (position != null && !Number.isFinite(position)) {
    res.status(400).json({ error: 'position must be a number' });
    return;
  }
  try {
    const created = await addItineraryChecklistItem(userId, req.params.detailId, { label, position });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/checklist-items/:itemId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await isFeatureEnabled(ITEM_KINDS_FEATURE_FLAG))) {
    res.status(403).json({ error: 'Itinerary item kinds are currently disabled', code: 'FEATURE_DISABLED' });
    return;
  }
  const body = req.body ?? {};
  const patch: { label?: string; checked?: boolean; position?: number } = {};
  if (body.label !== undefined) {
    const label = String(body.label ?? '').trim();
    if (!label) {
      res.status(400).json({ error: 'label cannot be empty' });
      return;
    }
    patch.label = label;
  }
  if (body.checked !== undefined) patch.checked = Boolean(body.checked);
  if (body.position !== undefined) {
    const position = Number(body.position);
    if (!Number.isFinite(position)) {
      res.status(400).json({ error: 'position must be a number' });
      return;
    }
    patch.position = position;
  }
  try {
    const updated = await updateItineraryChecklistItem(userId, req.params.itemId, patch);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/checklist-items/:itemId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await isFeatureEnabled(ITEM_KINDS_FEATURE_FLAG))) {
    res.status(403).json({ error: 'Itinerary item kinds are currently disabled', code: 'FEATURE_DISABLED' });
    return;
  }
  try {
    await deleteItineraryChecklistItem(userId, req.params.itemId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Reactions on itinerary detail rows.
// Reads (GET) are open to any trip member or follower.
// Writes (POST/DELETE) require full trip membership and the feature flag on.
// ---------------------------------------------------------------------------
router.get('/details/:detailId/reactions', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const ctx = await resolveDetailContext(req.params.detailId);
  if (!ctx) {
    res.status(404).json({ error: 'Itinerary detail not found' });
    return;
  }
  const access = await ensureUserCanReadTrip(ctx.tripId, userId);
  if (!access) {
    res.status(403).json({ error: 'Not authorized to view this itinerary detail' });
    return;
  }
  const summary = await getReactionSummaryForDetail(userId, req.params.detailId);
  res.json(summary);
});

router.post('/details/:detailId/reactions', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await isFeatureEnabled(REACTION_FEATURE_FLAG))) {
    res.status(403).json({ error: 'Itinerary reactions are currently disabled', code: 'FEATURE_DISABLED' });
    return;
  }
  let parsed;
  try {
    parsed = castReactionDto.parse(req.body ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid request body' });
      return;
    }
    throw err;
  }
  const ctx = await resolveDetailContext(req.params.detailId);
  if (!ctx) {
    res.status(404).json({ error: 'Itinerary detail not found' });
    return;
  }
  const membership = await ensureUserInTrip(ctx.tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may react' });
    return;
  }
  const summary = await upsertReaction(userId, ctx.tripId, req.params.detailId, parsed.value);
  res.json(summary);
});

router.delete('/details/:detailId/reactions', async (req, res) => {
  const userId = (req as any).user.userId as string;
  if (!(await isFeatureEnabled(REACTION_FEATURE_FLAG))) {
    res.status(403).json({ error: 'Itinerary reactions are currently disabled', code: 'FEATURE_DISABLED' });
    return;
  }
  const ctx = await resolveDetailContext(req.params.detailId);
  if (!ctx) {
    res.status(404).json({ error: 'Itinerary detail not found' });
    return;
  }
  const membership = await ensureUserInTrip(ctx.tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'Only trip members may react' });
    return;
  }
  const summary = await removeReaction(userId, req.params.detailId);
  res.json(summary);
});

export default router;
