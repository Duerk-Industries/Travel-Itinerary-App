import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { blogRepository } from '../blog/repository';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { getDayStarter, acceptDayStarter, dismissDayStarter } from '../services/blogDayStarterService';
import { groupMediaByDay } from '../services/blogMediaGroupingService';
import { BlogTargetNotFoundError } from '../services/blogEngagementErrors';
import { logError } from '../logger';

// Phase 1 of docs/trip-blog-social-implementation-plan.md (A3/A4): editing UI for
// blog_days.headline/summary and trip_blogs.title/subtitle/introduction, both of which have
// existed in the schema and the GET /:tripId/blog response since the original blog platform
// shipped, but had no write path at all until this file. See
// docs/trip-blog-social-architecture.md §4.05 for the day-metadata concurrency contract and §5
// for the route surface this belongs to.

const router = Router();
router.use(authenticate);

const userIdOf = (req: any): string => String(req.user?.userId ?? '');

const errorResponse = (res: any, err: any): void => {
  const message = String(err?.message ?? 'Unable to process blog request');
  if (/not authorized/i.test(message)) res.status(403).json({ error: message });
  else if (/outside|too large|too many|at most|must be|required|characters or fewer/i.test(message)) res.status(400).json({ error: message });
  else { logError('[blog-authoring] request failed', err); res.status(500).json({ error: message }); }
};

router.patch('/:tripId/blog/days/:dayDate', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const updateVersion = Number(req.body?.updateVersion);
    if (!Number.isInteger(updateVersion) || updateVersion < 1) {
      res.status(428).json({ error: 'updateVersion is required' });
      return;
    }
    const headline = req.body?.headline === undefined ? undefined : (req.body.headline === null ? null : String(req.body.headline));
    const summary = req.body?.summary === undefined ? undefined : (req.body.summary === null ? null : String(req.body.summary));
    const result = await blogRepository().updateBlogDayMeta(userIdOf(req), req.params.tripId, req.params.dayDate, { headline, summary, updateVersion });
    if (!result) {
      res.status(404).json({ error: 'That day was not found on this trip' });
      return;
    }
    if ('conflict' in result) {
      // Same conflict-banner contract as the item PATCH route (architecture §5.5, §4.05):
      // the 409 body carries the latest authorized headline/summary/updateVersion so the
      // client can offer Keep mine / Use theirs / Show both without a second round-trip.
      res.status(409).json({
        error: 'Someone else edited this day while you were writing',
        code: 'VERSION_CONFLICT',
        latest: result.latest ? {
          headline: result.latest.headline,
          summary: result.latest.summary,
          updateVersion: result.latest.updateVersion,
        } : null,
      });
      return;
    }
    res.json(result);
  } catch (err) {
    errorResponse(res, err);
  }
});

router.patch('/:tripId/blog', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const title = req.body?.title === undefined ? undefined : String(req.body.title);
    const subtitle = req.body?.subtitle === undefined ? undefined : (req.body.subtitle === null ? null : String(req.body.subtitle));
    const introduction = req.body?.introduction === undefined ? undefined : (req.body.introduction === null ? null : String(req.body.introduction));
    // Phase 5 (C2, PR-3): the trip-level photo-geotag toggle. Not retroactive — see
    // BlogMastheadPatch.photoLocationEnabled.
    const photoLocationEnabled = req.body?.photoLocationEnabled === undefined ? undefined : Boolean(req.body.photoLocationEnabled);
    const blog = await blogRepository().updateBlogMeta(userIdOf(req), req.params.tripId, { title, subtitle, introduction, photoLocationEnabled });
    res.json(blog);
  } catch (err) {
    errorResponse(res, err);
  }
});

// --- Day Starter (Phase 5, A1) ------------------------------------------------------------------
// Gated by the parent trip_blog_authoring_assist flag plus trip_blog_day_starter itself, matching
// architecture §9.1's parent/child flag pattern. A starter is never persisted before acceptance
// (FR-A1.2) — GET only ever computes and returns a suggestion, never writes.

const requireDayStarterEnabled = async (res: any): Promise<boolean> => {
  if (!(await isFeatureEnabled('trip_blog_authoring_assist')) || !(await isFeatureEnabled('trip_blog_day_starter'))) {
    res.status(404).json({ error: 'Day Starter is not enabled' });
    return false;
  }
  return true;
};

// Architecture §5.3: "Returns { draft, sources[] } or 204 if dismissed or the day already has
// text." getDayStarter returns null for exactly those two cases (plus "day not found on this
// trip," which the route also treats as 204 rather than 404 — a starter's absence is never
// itself sensitive information worth a distinguishable error).
router.get('/:tripId/blog/days/:dayDate/starter', async (req, res) => {
  try {
    if (!(await requireDayStarterEnabled(res))) return;
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_AUTHORING_WRITE', requireConfiguredLimit: true });
    const suggestion = await getDayStarter(req.params.tripId, userIdOf(req), req.params.dayDate);
    if (!suggestion) {
      res.status(204).end();
      return;
    }
    res.json({ draft: suggestion.body, sources: suggestion.sourceTypes });
  } catch (err) {
    if (err instanceof ApiLimitExceededError) {
      res.status(429).json({ error: 'Trip blog authoring is at capacity right now — please try again shortly' });
      return;
    }
    errorResponse(res, err);
  }
});

router.post('/:tripId/blog/days/:dayDate/starter/accept', async (req, res) => {
  try {
    if (!(await requireDayStarterEnabled(res))) return;
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_AUTHORING_WRITE', requireConfiguredLimit: true });
    const item = await acceptDayStarter(req.params.tripId, userIdOf(req), req.params.dayDate);
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof ApiLimitExceededError) {
      res.status(429).json({ error: 'Trip blog authoring is at capacity right now — please try again shortly' });
      return;
    }
    if (/no day starter suggestion/i.test(String((err as any)?.message))) {
      res.status(404).json({ error: (err as Error).message });
      return;
    }
    errorResponse(res, err);
  }
});

router.post('/:tripId/blog/days/:dayDate/starter/dismiss', async (req, res) => {
  try {
    if (!(await requireDayStarterEnabled(res))) return;
    await dismissDayStarter(req.params.tripId, userIdOf(req), req.params.dayDate);
    res.status(204).end();
  } catch (err) {
    errorResponse(res, err);
  }
});

// --- Media grouping (Phase 5, A2) --------------------------------------------------------------
// Stateless — no reads or writes against blog_media_assets/blog_storage_accounts, per architecture
// §5.3. Gated by trip_blog_authoring_assist + trip_blog_photo_composer (the parent surface for the
// photo-first composer this powers).
router.post('/:tripId/blog/media/group', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_authoring_assist')) || !(await isFeatureEnabled('trip_blog_photo_composer'))) {
      res.status(404).json({ error: 'The photo-first composer is not enabled' });
      return;
    }
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
    const result = await groupMediaByDay(req.params.tripId, userIdOf(req), candidates);
    res.json(result);
  } catch (err) {
    if (err instanceof BlogTargetNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    errorResponse(res, err);
  }
});

export default router;
